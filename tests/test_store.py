"""Store mapping helpers, token status, and legacy-data migration."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from store import Store, _direction, _interval, _public_last_sync  # noqa: E402


class StoreHelperTests(unittest.TestCase):
    def test_public_last_sync_strips_file_shas(self) -> None:
        self.assertIsNone(_public_last_sync(None))
        self.assertIsNone(_public_last_sync({}))
        public = _public_last_sync(
            {
                "at": "2026-01-01T00:00:00Z",
                "direction": "upload",
                "commit_sha": "abc",
                "html_url": "https://example",
                "uploaded": 3,
                "downloaded": None,
                "file_shas": {"a.txt": "deadbeef"},
            }
        )
        assert public is not None
        self.assertNotIn("file_shas", public)
        self.assertEqual(public["commit_sha"], "abc")

    def test_public_last_sync_keeps_truncation_flag(self) -> None:
        public = _public_last_sync(
            {"at": "x", "file_shas": {"a": "b"}, "file_shas_truncated": True,
             "file_shas_total": 9999}
        )
        assert public is not None
        self.assertTrue(public["file_shas_truncated"])
        self.assertEqual(public["file_shas_total"], 9999)

    def test_interval_validation(self) -> None:
        self.assertEqual(_interval(60, 60), 60)
        self.assertEqual(_interval("15", 60), 15)
        self.assertEqual(_interval(1, 60), 5)  # minimum 5 minutes
        self.assertEqual(_interval(None, 60), 60)
        self.assertEqual(_interval("nope", 60), 60)
        self.assertEqual(_interval(None, None), 60)

    def test_direction_validation(self) -> None:
        self.assertEqual(_direction("download", "upload"), "download")
        self.assertEqual(_direction("check", "upload"), "check")
        self.assertEqual(_direction("sideways", "upload"), "upload")
        self.assertEqual(_direction(None, None), "upload")


class StoreMappingTests(unittest.TestCase):
    def _temp_store(self, tmp: Path) -> Store:
        os.environ["GITHUB_SYNC_DATA"] = str(tmp / "state.json")
        return Store()

    def test_save_and_list_mapping_roundtrip(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            try:
                store = self._temp_store(tmp)
                saved = asyncio.run(
                    store.save_mapping({"local_path": "homeassistant", "repository": "o/r"})
                )
                self.assertTrue(saved["id"])
                self.assertEqual(saved["auto_interval_minutes"], 60)
                mappings = store.mappings()
                self.assertEqual(len(mappings), 1)
                self.assertEqual(mappings[0]["branch"], "main")
                # Update keeps the same id and validates auto-sync fields.
                updated = asyncio.run(
                    store.save_mapping(
                        {
                            "id": saved["id"],
                            "local_path": "homeassistant",
                            "repository": "o/r",
                            "auto_interval_minutes": 1,
                            "auto_direction": "sideways",
                        }
                    )
                )
                self.assertEqual(updated["id"], saved["id"])
                self.assertEqual(updated["auto_interval_minutes"], 5)
                self.assertEqual(updated["auto_direction"], "upload")
                asyncio.run(store.delete_mapping(saved["id"]))
                self.assertEqual(store.mappings(), [])
            finally:
                os.environ.pop("GITHUB_SYNC_DATA", None)

    def test_public_status_never_exposes_token(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            try:
                store = self._temp_store(tmp)
                asyncio.run(store.set_token("gho_secret", "octocat", 1))
                public = store.public_status()
                blob = json.dumps(public)
                self.assertNotIn("gho_secret", blob)
                self.assertNotIn("oauth", public)
                self.assertTrue(public["configured"])
                self.assertEqual(public["username"], "octocat")
            finally:
                os.environ.pop("GITHUB_SYNC_DATA", None)

    def test_load_drops_legacy_oauth_config(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            try:
                path = tmp / "state.json"
                path.write_text(
                    json.dumps(
                        {
                            "access_token": "x",
                            "oauth": {"client_id": "a", "client_secret": "b"},
                            "mappings": [],
                        }
                    ),
                    encoding="utf-8",
                )
                os.environ["GITHUB_SYNC_DATA"] = str(path)
                store = Store()
                asyncio.run(store.load())
                self.assertNotIn("oauth", store.data)
                self.assertEqual(store.data["access_token"], "x")
            finally:
                os.environ.pop("GITHUB_SYNC_DATA", None)


if __name__ == "__main__":
    unittest.main()
