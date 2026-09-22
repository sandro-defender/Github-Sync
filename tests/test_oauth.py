"""OAuth configuration and flow-safety tests."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from oauth import OAuthBroker, normalize_scope, oauth_base_from_api  # noqa: E402
from store import Store  # noqa: E402


class OAuthTests(unittest.TestCase):
    def test_scope_is_limited_to_supported_choices(self) -> None:
        self.assertEqual(normalize_scope("repo"), "repo")
        self.assertEqual(normalize_scope("public_repo"), "public_repo")
        self.assertEqual(normalize_scope("admin:org"), "repo")

    def test_oauth_base_for_github_and_enterprise(self) -> None:
        self.assertEqual(oauth_base_from_api("https://api.github.com"), "https://github.com")
        self.assertEqual(
            oauth_base_from_api("https://github.example.com/api/v3"),
            "https://github.example.com",
        )

    def test_public_status_does_not_expose_oauth_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            os.environ["GITHUB_SYNC_DATA"] = str(Path(directory) / "state.json")
            try:
                store = Store()
                store.data["oauth"] = {
                    "client_id": "client-id",
                    "client_secret": "super-secret",
                    "redirect_uri": "https://ha.example/api/oauth/callback",
                    "scope": "repo",
                }
                public = store.public_status()
            finally:
                os.environ.pop("GITHUB_SYNC_DATA", None)
        self.assertNotIn("client_secret", public["oauth"])
        self.assertTrue(public["oauth"]["client_secret_configured"])

    def test_web_state_is_random_and_authorize_url_contains_required_values(self) -> None:
        broker = OAuthBroker()
        result = broker.start_web(
            client_id="client-id",
            client_secret="secret",
            redirect_uri="https://ha.example/api/oauth/callback",
            return_to="/",
            scope="public_repo",
            oauth_base="https://github.com",
        )
        parsed = urlsplit(result["authorize_url"])
        params = parse_qs(parsed.query)
        self.assertEqual(params["client_id"], ["client-id"])
        self.assertEqual(params["scope"], ["public_repo"])
        self.assertEqual(params["redirect_uri"], ["https://ha.example/api/oauth/callback"])
        self.assertIn(params["state"][0], broker.web_flows)
        self.assertGreaterEqual(len(params["state"][0]), 32)


if __name__ == "__main__":
    unittest.main()
