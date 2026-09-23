"""Permission policies are enforced server-side, not just hidden by the UI."""
import copy
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from access import AccessDenied, require_access, validate_access
from github_client import GithubClient
import main
from oauth import OAuthBroker
from progress import ProgressHub
from store import Store


class AccessTests(unittest.TestCase):
    def test_normalize_and_deduplicate(self):
        self.assertEqual(validate_access({"mode": "read", "repositories": ["Owner/Repo", "owner/repo"]}),
                         {"mode": "read", "repositories": ["owner/repo"]})

    def test_invalid_policies(self):
        for value in (None, {}, {"mode": "admin", "repositories": []},
                      {"mode": "read", "repositories": "owner/repo"},
                      {"mode": "read", "repositories": ["owner/../other"]},
                      {"mode": "read", "repositories": ["owner/.."]},
                      {"mode": "read", "repositories": ["owner/repo?x=y"]}):
            with self.assertRaises(ValueError):
                validate_access(value)

    def test_empty_means_none_legacy_means_unrestricted(self):
        require_access(None, "owner/repo", write=True)
        # Empty repository allowlist allows all repositories
        require_access({"mode": "write", "repositories": []}, "owner/repo")
        with self.assertRaises(AccessDenied):
            require_access({"mode": "write", "repositories": ["other/repo"]}, "owner/repo")


class APIAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"GITHUB_SYNC_DATA": str(Path(self.tmp.name) / "store.json")})
        self.env.start()
        self.store = Store()
        self.mapping = {"id": "one", "local_path": "local", "repository": "owner/repo"}
        self.store.data.update(access_token="secret", access={"mode": "read", "repositories": ["owner/repo"]}, mappings=[self.mapping])
        main.app.state.store = self.store
        main.app.state.roots = {"local": Path(self.tmp.name)}
        main.app.state.progress = ProgressHub()
        main.app.state.session = AsyncMock()
        main.app.state.oauth = OAuthBroker()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.env.stop()
        self.tmp.cleanup()

    async def test_upload_denied_manual_and_auto_before_engine(self):
        with patch.object(main, "engine") as engine:
            response = await self.client.post("/api/upload", json={"mapping_id": "one"})
            self.assertEqual(response.status_code, 403)
            with self.assertRaises(AccessDenied):
                await main._execute(self.mapping, "upload", source="auto")
            engine.assert_not_called()

    async def test_unselected_repository_and_auto_mapping_denied(self):
        response = await self.client.get("/api/branches", params={"repository": "owner/other"})
        self.assertEqual(response.status_code, 403)
        for body in ({"local_path": "local", "repository": "owner/other"},
                     {"local_path": "local", "repository": "owner/repo", "auto_sync": True, "auto_direction": "upload"}):
            response = await self.client.post("/api/mappings", json=body)
            self.assertEqual(response.status_code, 403)

    async def test_permission_changes_apply_to_existing_mappings(self):
        response = await self.client.post("/api/access", json={"mode": "read", "repositories": ["other/repo"]})
        self.assertEqual(response.status_code, 200)
        response = await self.client.post("/api/check", json={"mapping_id": "one"})
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("secret", response.text)

    async def test_token_not_returned_and_logout_resets_policy(self):
        with patch.object(main.GithubClient, "get_user", new=AsyncMock(return_value={"login": "me", "id": 1})):
            response = await self.client.post("/api/token", json={"token": "github_pat_secret", "access": self.store.data["access"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["auth_method"], "fine_grained")
        self.assertNotIn("github_pat_secret", response.text)
        response = await self.client.get("/api/status")
        self.assertNotIn("github_pat_secret", response.text)
        reloaded = Store()
        await reloaded.load()
        self.assertEqual(reloaded.data["access"], self.store.data["access"])
        await self.client.delete("/api/token")
        self.assertIsNone(self.store.data["access"])
        self.assertFalse(self.store.data["access_token"])

    async def test_invalid_token_does_not_replace_existing_connection(self):
        before = copy.deepcopy(self.store.data)
        response = await self.client.post("/api/token", json={"token": "ghp_classic", "access": self.store.data["access"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.data, before)

    async def test_poll_cannot_override_frozen_policy_or_leak_token(self):
        main.app.state.oauth.poll_device = AsyncMock(return_value={"status": "authorized", "access_token": "oauth-secret", "access": self.store.data["access"], "scope": "repo"})
        with patch.object(main.GithubClient, "get_user", new=AsyncMock(return_value={"login": "me", "id": 1})):
            response = await self.client.post("/api/oauth/device/poll", json={"flow_id": "flow", "access": {"mode": "write", "repositories": []}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.store.data["access"]["mode"], "read")
        self.assertNotIn("oauth-secret", response.text)

    async def test_client_blocks_writes_and_other_hosts_without_network(self):
        client = GithubClient(AsyncMock(), "secret", "https://api.github.com", self.store.data["access"])
        for method, path in (("POST", "/repos/owner/repo/git/blobs"),
                             ("GET", "/repos/owner/other/branches"),
                             ("GET", "https://evil.example/user"),
                             ("GET", "/repos/owner/repo/../../other/branches")):
            with self.assertRaises(AccessDenied):
                await client.request(method, path)
        client._session.request.assert_not_called()

    async def test_repo_picker_filtered(self):
        client = GithubClient(AsyncMock(), "secret", "https://api.github.com", self.store.data["access"])
        client.request = AsyncMock(return_value=[{"full_name": "Owner/Repo"}, {"full_name": "Owner/Other"}])
        self.assertEqual([r["full_name"] for r in await client.list_repos()], ["Owner/Repo"])
