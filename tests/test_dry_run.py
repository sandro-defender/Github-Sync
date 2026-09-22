"""Dry runs must never mutate GitHub, local files, metadata or notifications."""
import copy
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

import main
from github_client import GithubClient
from paths import PathError
from progress import ProgressHub
from store import Store
from sync import SyncEngine, git_blob_sha


class DryRunTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.folder = self.root / "folder"
        self.folder.mkdir()
        for name, content in {"same.txt": b"same", "changed.txt": b"local", "local.txt": b"local only", "secrets.yaml": b"secret"}.items():
            (self.folder / name).write_bytes(content)
        self.mapping = {"id": "one", "repository": "owner/repo", "local_path": "local/folder", "branch": "main", "repo_path": "ha", "ignore_upload": "secrets.yaml\n", "ignore_download": "secrets.yaml\n", "last_error": "preserve this", "last_sync": {"at": "yesterday", "file_shas": {"old": "hash"}}}
        self.remote_bytes = {"ha/same.txt": b"same", "ha/changed.txt": b"remote", "ha/remote.txt": b"remote only", "ha/secrets.yaml": b"remote secret", "README.md": b"outside mapping"}
        self.remote = {p: git_blob_sha(b) for p, b in self.remote_bytes.items()}
        self.client = AsyncMock(spec=GithubClient)
        self.client.get_ref.return_value = {"object": {"sha": "head"}}
        self.client.get_commit.return_value = {"tree": {"sha": "tree"}}
        self.client.get_tree.return_value = {"tree": [{"path": p, "sha": sha, "type": "blob"} for p, sha in self.remote.items()]}
        self.client.get_blob.side_effect = lambda owner, repo, sha: next(b for p, b in self.remote_bytes.items() if self.remote[p] == sha)
        self.engine = SyncEngine(self.client, {"local": self.root})
        self.env = patch.dict(os.environ, {"GITHUB_SYNC_DATA": str(self.root / "store.json")})
        self.env.start()
        self.store = Store()
        self.store.data.update(access_token="test-token", access={"mode": "read", "repositories": ["owner/repo"]}, mappings=[self.mapping])
        await self.store.save()
        main.app.state.store = self.store
        main.app.state.progress = ProgressHub()
        main.app.state.roots = {"local": self.root}
        self.api = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.api.aclose()
        self.env.stop()
        self.tmp.cleanup()

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def assert_no_remote_writes(self):
        for method in ("create_blob", "create_blobs", "create_tree", "create_commit", "update_ref"):
            getattr(self.client, method).assert_not_called()

    async def test_upload_plan_includes_remote_deletions_and_preserves_outside_subtree(self):
        before = self.snapshot()
        result = await self.engine.upload(self.mapping, dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["create_count"], 1)
        self.assertEqual(result["update_count"], 1)
        self.assertEqual(result["delete_count"], 2)
        self.assertEqual(result["unchanged"], 1)
        self.assertIn({"path": "ha/secrets.yaml", "action": "delete"}, result["actions"])
        self.assertNotIn("README.md", [a["path"] for a in result["actions"]])
        self.assertNotIn("file_shas", result)
        self.assertEqual(before, self.snapshot())
        self.assert_no_remote_writes()

    async def test_root_upload_empty_repo_and_empty_local(self):
        mapping = {**self.mapping, "repo_path": ""}
        result = await self.engine.upload(mapping, dry_run=True)
        self.assertIn({"path": "README.md", "action": "delete"}, result["actions"])
        self.client.get_ref.return_value = None
        result = await self.engine.upload(mapping, dry_run=True)
        self.assertIsNone(result["commit_sha"])
        self.assertEqual(result["create_count"], 3)
        self.assertEqual(result["delete_count"], 0)
        with self.assertRaises(PathError):
            await self.engine.upload({**mapping, "ignore_upload": "*"}, dry_run=True)
        self.assert_no_remote_writes()

    async def test_download_delete_extras_is_opt_in_and_respects_ignores(self):
        before = self.snapshot()
        for cleanup, deleted in ((False, 0), (True, 1)):
            result = await self.engine.download(self.mapping, delete_extras=cleanup, dry_run=True)
            self.assertEqual(result["create_count"], 1)
            self.assertEqual(result["update_count"], 1)
            self.assertEqual(result["delete_count"], deleted)
            self.assertEqual(result["unchanged"], 1)
            self.assertEqual(result["skipped"], 1)
            self.assertNotIn("secrets.yaml", [a["path"] for a in result["actions"]])
            self.assertEqual(before, self.snapshot())
        self.client.get_blob.assert_not_called()
        self.assert_no_remote_writes()

    async def test_download_preview_matches_real_execution(self):
        plan = await self.engine.download(self.mapping, delete_extras=True, dry_run=True)
        result = await self.engine.download(self.mapping, delete_extras=True)
        self.assertEqual(result["downloaded"], plan["create_count"] + plan["update_count"])
        self.assertEqual(result["deleted"], plan["delete_count"])
        self.assertEqual((self.folder / "changed.txt").read_bytes(), b"remote")
        self.assertFalse((self.folder / "local.txt").exists())
        self.assertEqual((self.folder / "secrets.yaml").read_bytes(), b"secret")

    async def test_upload_preview_matches_actual_tree(self):
        plan = await self.engine.upload(self.mapping, dry_run=True)
        self.client.create_blobs.side_effect = lambda owner, repo, files, **kwargs: {p: git_blob_sha(b) for p, b in files}
        self.client.create_tree.return_value = "new-tree"
        self.client.create_commit.return_value = {"sha": "new-head"}
        await self.engine.upload(self.mapping)
        tree = {e["path"]: e["sha"] for e in self.client.create_tree.call_args.args[2]}
        observed = []
        for p, sha in tree.items():
            if p not in self.remote:
                observed.append({"path": p, "action": "create"})
            elif self.remote[p] != sha:
                observed.append({"path": p, "action": "update"})
        observed.extend({"path": p, "action": "delete"} for p in self.remote if p not in tree)
        self.assertEqual(plan["actions"], sorted(observed, key=lambda a: a["path"]))

    async def test_api_dry_run_does_not_save_history_or_notify_even_on_failure(self):
        before_data, before_files = copy.deepcopy(self.store.data), self.snapshot()
        with patch.object(main, "engine", return_value=self.engine), patch.object(self.store, "save", new_callable=AsyncMock) as save, patch.object(main, "_notify_failure", new_callable=AsyncMock) as notify:
            # A read-only connection can preview upload, but cannot execute it.
            for direction in ("upload", "download"):
                response = await self.api.post(f"/api/{direction}", json={"mapping_id": "one", "dry_run": True})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(response.json()["dry_run"])
            self.client.get_ref.return_value = None
            response = await self.api.post("/api/download", json={"mapping_id": "one", "dry_run": True})
            self.assertEqual(response.status_code, 400)
            save.assert_not_called()
            notify.assert_not_called()
        self.assertEqual(self.store.data, before_data)
        self.assertEqual(self.snapshot(), before_files)
        self.assert_no_remote_writes()

    async def test_string_dry_run_cannot_accidentally_execute(self):
        with patch.object(main, "engine") as engine:
            for direction in ("upload", "download"):
                for value in ("true", "false", 1, None):
                    response = await self.api.post(f"/api/{direction}", json={"mapping_id": "one", "dry_run": value})
                    self.assertEqual(response.status_code, 400)
            engine.assert_not_called()

    async def test_truncated_trees_and_walks_are_rejected(self):
        self.client.get_tree.return_value = {"truncated": True, "tree": []}
        with self.assertRaises(PathError):
            await self.engine.upload(self.mapping, dry_run=True)
        with patch("sync.collect_files", return_value=([], [], True)):
            with self.assertRaises(PathError):
                await self.engine.upload(self.mapping, dry_run=True)
        self.assert_no_remote_writes()

    async def test_local_symlink_escape_and_remote_traversal_rejected(self):
        outside = self.root / "outside.txt"
        outside.write_text("private")
        (self.folder / "escape.txt").symlink_to(outside)
        with self.assertRaises(PathError):
            await self.engine.upload(self.mapping, dry_run=True)
        (self.folder / "escape.txt").unlink()
        self.client.get_tree.return_value = {"tree": [{"path": "ha/../outside.txt", "type": "blob", "sha": "bad"}]}
        with self.assertRaises(PathError):
            await self.engine.download(self.mapping, dry_run=True)
        self.assertEqual(outside.read_text(), "private")
        self.assert_no_remote_writes()
