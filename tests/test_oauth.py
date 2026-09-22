"""Device-flow OAuth broker tests (the only sign-in method)."""

from __future__ import annotations

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from oauth import (  # noqa: E402
    DEVICE_SCOPE,
    GITHUB_API_BASE,
    GITHUB_CLI_CLIENT_ID,
    GITHUB_OAUTH_BASE,
    OAuthBroker,
    OAuthError,
)


def _response(payload: dict, status: int = 200):
    response = AsyncMock()
    response.status = status
    response.headers = {"Content-Type": "application/json"}
    import json as _json

    response.text = AsyncMock(return_value=_json.dumps(payload))
    context = AsyncMock()
    context.__aenter__ = AsyncMock(return_value=response)
    context.__aexit__ = AsyncMock(return_value=False)
    return context


class OAuthTests(unittest.TestCase):
    def test_builtin_client_constants(self) -> None:
        self.assertTrue(GITHUB_CLI_CLIENT_ID)
        self.assertEqual(GITHUB_OAUTH_BASE, "https://github.com")
        self.assertEqual(GITHUB_API_BASE, "https://api.github.com")
        self.assertEqual(DEVICE_SCOPE, "repo")

    def test_start_device_returns_code_and_link(self) -> None:
        session = AsyncMock()
        session.post = lambda *a, **k: _response(
            {
                "device_code": "dev-123",
                "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            }
        )
        broker = OAuthBroker()
        result = asyncio.run(broker.start_device(session))
        self.assertEqual(result["user_code"], "ABCD-1234")
        self.assertIn("github.com/login/device", result["verification_uri"])
        self.assertIn(result["flow_id"], broker.device_flows)

    def test_start_device_surfaces_github_errors(self) -> None:
        session = AsyncMock()
        session.post = lambda *a, **k: _response(
            {"error": "slow_down", "error_description": "too fast"}, status=200
        )
        broker = OAuthBroker()
        with self.assertRaises(OAuthError):
            asyncio.run(broker.start_device(session))

    def test_poll_unknown_flow_raises(self) -> None:
        broker = OAuthBroker()
        with self.assertRaises(OAuthError):
            asyncio.run(broker.poll_device(AsyncMock(), "missing"))

    def test_poll_authorized_returns_token_once(self) -> None:
        session = AsyncMock()
        session.post = lambda *a, **k: _response(
            {
                "device_code": "dev-123",
                "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            }
        )
        broker = OAuthBroker()
        started = asyncio.run(broker.start_device(session))
        flow_id = started["flow_id"]
        session.post = lambda *a, **k: _response({"access_token": "gho_secret"})
        result = asyncio.run(broker.poll_device(session, flow_id))
        self.assertEqual(result["status"], "authorized")
        self.assertEqual(result["access_token"], "gho_secret")
        self.assertNotIn(flow_id, broker.device_flows)

    def test_poll_pending_then_slow_down(self) -> None:
        session = AsyncMock()
        session.post = lambda *a, **k: _response(
            {
                "device_code": "dev-123",
                "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            }
        )
        broker = OAuthBroker()
        flow_id = asyncio.run(broker.start_device(session))["flow_id"]
        session.post = lambda *a, **k: _response({"error": "authorization_pending"})
        result = asyncio.run(broker.poll_device(session, flow_id))
        self.assertEqual(result["status"], "pending")
        # Immediate re-poll is throttled locally without hitting GitHub.
        throttled = asyncio.run(broker.poll_device(session, flow_id))
        self.assertEqual(throttled["status"], "pending")

    def test_cancel_and_expiry_cleanup(self) -> None:
        broker = OAuthBroker()
        broker.cancel_device("never-existed")  # must not raise
        session = AsyncMock()
        session.post = lambda *a, **k: _response(
            {
                "device_code": "dev-123",
                "user_code": "ABCD-1234",
                "verification_uri": "https://github.com/login/device",
                "expires_in": -1,
                "interval": 5,
            }
        )
        flow_id = asyncio.run(broker.start_device(session))["flow_id"]
        broker.device_flows[flow_id].expires_at = time.time() - 1
        with self.assertRaises(OAuthError):
            asyncio.run(broker.poll_device(session, flow_id))


if __name__ == "__main__":
    unittest.main()
