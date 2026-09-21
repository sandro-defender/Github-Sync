"""Path sandbox tests (no Home Assistant required)."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from paths import PathError, browse_directory, discover_roots, resolve_under_roots  # noqa: E402


class PathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "homeassistant"
        self.root.mkdir()
        (self.root / "esphome").mkdir()
        (self.root / "esphome" / "living.yaml").write_text("x\n", encoding="utf-8")
        self.roots = {"homeassistant": self.root.resolve()}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_resolve_inside(self) -> None:
        path = resolve_under_roots(self.roots, "homeassistant/esphome")
        self.assertTrue(path.is_dir())
        self.assertEqual(path.name, "esphome")

    def test_blocks_escape(self) -> None:
        with self.assertRaises(PathError):
            resolve_under_roots(self.roots, "homeassistant/../../etc")

    def test_unknown_mount(self) -> None:
        with self.assertRaises(PathError):
            resolve_under_roots(self.roots, "not_a_mount/foo")

    def test_browse_root_and_child(self) -> None:
        listing = browse_directory(self.roots, "")
        names = [item["name"] for item in listing["entries"]]
        self.assertIn("homeassistant", names)
        child = browse_directory(self.roots, "homeassistant")
        child_names = [item["name"] for item in child["entries"]]
        self.assertIn("esphome", child_names)

    def test_discover_from_env(self) -> None:
        os.environ["GITHUB_SYNC_ROOTS"] = f"workspace:{self.root}"
        try:
            found = discover_roots()
            self.assertIn("workspace", found)
        finally:
            os.environ.pop("GITHUB_SYNC_ROOTS", None)


if __name__ == "__main__":
    unittest.main()
