"""GitHub OAuth device flow for the Home Assistant App.

For device authorization: the app shows a short
user code, the user approves it on github.com, and the app polls until
GitHub returns an access token. No OAuth App registration, no callback
URL, no client secret, no token to paste.

The flow uses the public GitHub CLI OAuth client ID — the same
zero-config approach other Home Assistant apps (e.g. Home Assistant
Version Control) use. Client IDs are not secrets: they ship with every
client, and the device flow needs no client secret at all.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from aiohttp import ClientSession, ClientTimeout
from access import validate_access


GITHUB_OAUTH_BASE = "https://github.com"
GITHUB_API_BASE = "https://api.github.com"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
DEVICE_SCOPE = "repo"
DEVICE_SCOPES = {"public_read": "", "public_write": "public_repo", "repo": "repo"}

#: Public OAuth client ID of the GitHub CLI, used as the built-in
#: device-flow client so users can connect with one click.
GITHUB_CLI_CLIENT_ID = "178c6fc778ccc68e1d6a"


class OAuthError(Exception):
    """The GitHub OAuth service rejected or could not complete a flow."""


async def _post_form(session: ClientSession, url: str, values: dict[str, str]) -> dict[str, Any]:
    try:
        async with session.post(
            url,
            data=values,
            headers={"Accept": "application/json"},
            timeout=ClientTimeout(total=60),
        ) as response:
            text = await response.text()
            if response.status >= 400:
                raise OAuthError(f"GitHub OAuth error {response.status}: {text[:240]}")
            content_type = response.headers.get("Content-Type", "")
            if "json" in content_type:
                data = json.loads(text or "{}")
            else:
                from urllib.parse import parse_qs

                data = {key: values[0] for key, values in parse_qs(text).items()}
            if not isinstance(data, dict):
                raise OAuthError("GitHub returned an invalid OAuth response")
            return data
    except OAuthError:
        raise
    except Exception as err:  # noqa: BLE001
        raise OAuthError(f"Cannot reach GitHub OAuth: {err}") from err


@dataclass
class DeviceFlow:
    flow_id: str
    device_code: str
    interval: int
    expires_at: float
    access: dict[str, Any] | None = None
    scope: str = "repo"
    last_poll: float = 0.0


class OAuthBroker:
    """Keep short-lived device codes out of persistent app data."""

    def __init__(self) -> None:
        self.device_flows: dict[str, DeviceFlow] = {}

    def _cleanup(self) -> None:
        now = time.time()
        self.device_flows = {
            key: flow for key, flow in self.device_flows.items() if flow.expires_at > now
        }

    async def start_device(self, session: ClientSession, *, scope: str = "repo", access: dict[str, Any] | None = None) -> dict[str, Any]:
        """Begin a device authorization and return the code + GitHub link."""
        if scope not in DEVICE_SCOPES:
            raise OAuthError("Unknown GitHub permission scope")
        if access is not None:
            access = validate_access(access)
        self._cleanup()
        data = await _post_form(
            session,
            f"{GITHUB_OAUTH_BASE}/login/device/code",
            {"client_id": GITHUB_CLI_CLIENT_ID, "scope": DEVICE_SCOPES[scope]},
        )
        if data.get("error"):
            raise OAuthError(data.get("error_description") or data["error"])
        device_code = str(data.get("device_code") or "")
        user_code = str(data.get("user_code") or "")
        if not device_code or not user_code:
            raise OAuthError("GitHub did not return a device authorization code")
        flow_id = secrets.token_urlsafe(24)
        expires_in = int(data.get("expires_in") or 900)
        interval = max(5, int(data.get("interval") or 5))
        self.device_flows[flow_id] = DeviceFlow(
            flow_id=flow_id,
            device_code=device_code,
            interval=interval,
            expires_at=time.time() + expires_in,
            access=access,
            scope=scope,
        )
        verification_uri = data.get("verification_uri") or data.get("verification_url")
        return {
            "flow_id": flow_id,
            "user_code": user_code,
            "verification_uri": verification_uri or f"{GITHUB_OAUTH_BASE}/login/device",
            "verification_uri_complete": data.get("verification_uri_complete"),
            "expires_in": expires_in,
            "interval": interval,
        }

    async def poll_device(self, session: ClientSession, flow_id: str) -> dict[str, Any]:
        self._cleanup()
        flow = self.device_flows.get(flow_id)
        if not flow:
            raise OAuthError("The device authorization has expired; start again")
        now = time.time()
        if flow.last_poll and now - flow.last_poll < flow.interval:
            return {
                "status": "pending",
                "retry_after": max(1, int(flow.interval - (now - flow.last_poll))),
            }
        flow.last_poll = now
        data = await _post_form(
            session,
            f"{GITHUB_OAUTH_BASE}/login/oauth/access_token",
            {
                "client_id": GITHUB_CLI_CLIENT_ID,
                "device_code": flow.device_code,
                "grant_type": DEVICE_GRANT,
            },
        )
        error = data.get("error")
        if error == "authorization_pending":
            return {"status": "pending", "retry_after": flow.interval}
        if error == "slow_down":
            flow.interval += 5
            return {"status": "pending", "retry_after": flow.interval}
        if error:
            self.device_flows.pop(flow_id, None)
            raise OAuthError(data.get("error_description") or str(error))
        token = str(data.get("access_token") or "")
        if not token:
            raise OAuthError("GitHub did not return an access token")
        self.device_flows.pop(flow_id, None)
        return {"status": "authorized", "access_token": token, "access": flow.access, "scope": flow.scope}

    def cancel_device(self, flow_id: str) -> None:
        self.device_flows.pop(flow_id, None)
