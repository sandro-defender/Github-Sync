"""GitHub OAuth device and browser flows for the Home Assistant App."""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

from aiohttp import ClientSession, ClientTimeout


GITHUB_OAUTH_BASE = "https://github.com"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
ALLOWED_SCOPES = {"repo", "public_repo"}


class OAuthError(Exception):
    """The GitHub OAuth service rejected or could not complete a flow."""


def normalize_scope(scope: str | None) -> str:
    value = (scope or "repo").strip()
    return value if value in ALLOWED_SCOPES else "repo"


def oauth_base_from_api(api_base: str | None) -> str:
    """Return the OAuth host matching github.com or a GitHub Enterprise API."""
    raw = (api_base or "https://api.github.com").strip().rstrip("/")
    parsed = urlsplit(raw)
    if not parsed.scheme or not parsed.netloc:
        return GITHUB_OAUTH_BASE
    if parsed.hostname == "api.github.com":
        return GITHUB_OAUTH_BASE
    path = parsed.path.removesuffix("/api/v3").rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", "")).rstrip("/")


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
                # GitHub Enterprise versions may return form-encoded OAuth responses.
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
    client_id: str
    oauth_base: str
    interval: int
    expires_at: float
    last_poll: float = 0.0


@dataclass
class WebFlow:
    state: str
    client_id: str
    client_secret: str
    redirect_uri: str
    return_to: str
    oauth_base: str
    scope: str
    expires_at: float


class OAuthBroker:
    """Keep short-lived OAuth codes and states out of persistent app data."""

    def __init__(self) -> None:
        self.device_flows: dict[str, DeviceFlow] = {}
        self.web_flows: dict[str, WebFlow] = {}

    def _cleanup(self) -> None:
        now = time.time()
        self.device_flows = {
            key: flow for key, flow in self.device_flows.items() if flow.expires_at > now
        }
        self.web_flows = {
            key: flow for key, flow in self.web_flows.items() if flow.expires_at > now
        }

    async def start_device(
        self,
        session: ClientSession,
        *,
        client_id: str,
        scope: str,
        oauth_base: str,
    ) -> dict[str, Any]:
        self._cleanup()
        data = await _post_form(
            session,
            f"{oauth_base}/login/device/code",
            {"client_id": client_id, "scope": normalize_scope(scope)},
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
            client_id=client_id,
            oauth_base=oauth_base,
            interval=interval,
            expires_at=time.time() + expires_in,
        )
        verification_uri = data.get("verification_uri") or data.get("verification_url")
        return {
            "flow_id": flow_id,
            "user_code": user_code,
            "verification_uri": verification_uri or f"{oauth_base}/login/device",
            "verification_uri_complete": data.get("verification_uri_complete"),
            "expires_in": expires_in,
            "interval": interval,
            "scope": normalize_scope(scope),
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
            f"{flow.oauth_base}/login/oauth/access_token",
            {
                "client_id": flow.client_id,
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
        return {"status": "authorized", "access_token": token}

    def start_web(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        return_to: str,
        scope: str,
        oauth_base: str,
    ) -> dict[str, str]:
        self._cleanup()
        state = secrets.token_urlsafe(32)
        self.web_flows[state] = WebFlow(
            state=state,
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            return_to=return_to,
            oauth_base=oauth_base,
            scope=normalize_scope(scope),
            expires_at=time.time() + 600,
        )
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": normalize_scope(scope),
            "state": state,
        }
        return {"authorize_url": f"{oauth_base}/login/oauth/authorize?{urlencode(params)}"}

    async def finish_web(
        self, session: ClientSession, *, code: str, state: str
    ) -> tuple[WebFlow, str]:
        self._cleanup()
        flow = self.web_flows.pop(state, None)
        if not flow:
            raise OAuthError("Invalid or expired OAuth state")
        data = await _post_form(
            session,
            f"{flow.oauth_base}/login/oauth/access_token",
            {
                "client_id": flow.client_id,
                "client_secret": flow.client_secret,
                "code": code,
                "redirect_uri": flow.redirect_uri,
                "state": state,
            },
        )
        if data.get("error"):
            raise OAuthError(data.get("error_description") or data["error"])
        token = str(data.get("access_token") or "")
        if not token:
            raise OAuthError("GitHub did not return an access token")
        return flow, token

    def cancel_device(self, flow_id: str) -> None:
        self.device_flows.pop(flow_id, None)
