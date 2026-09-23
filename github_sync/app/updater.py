"""Check for a newer GitHub Sync app version and trigger instant updates.

Update sources, in order of preference:

1. **Supervisor** — ``GET /addons/self/info`` on the Supervisor API returns
   this app's installed ``version``, the store's ``version_latest`` and the
   Supervisor's own ``update_available`` flag. This is the same data Home
   Assistant shows on the app's update entity, so what the check reports is
   exactly what an update would install.
2. **GitHub releases** — used when there is no ``SUPERVISOR_TOKEN`` (local
   development) or the Supervisor is not reachable. The public
   ``releases/latest`` endpoint of the app's own repository is queried.

``UpdateChecker`` runs a background check every 30 minutes, caches the result,
persists minimal metadata to ``/data`` (so the "update available" Home
Assistant notification fires once per version), and can be forced from the UI
(``POST /api/updates/check``).

The actual update is triggered through **Home Assistant Core**: the Supervisor
explicitly refuses an app updating *itself* (``App <slug> can't update
itself!``), but this app has ``homeassistant_api: true`` and may call Core
services. Core automatically provides an ``update`` entity for every installed
app (hassio integration); the app finds that entity via ``GET /core/api/states``
(matched on the ``update.`` domain, the entity ``title`` attribute and, when
known, the expected latest version) and calls the ``update/install`` service.
Core then asks the Supervisor to redownload and restart this app — the
container may be restarted before the HTTP response arrives, which is treated
as "update started".
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout
from ha import notify_ha, supervisor_token
from version import APP_NAME, APP_REPO, __version__

_LOGGER = logging.getLogger(__name__)

SUPERVISOR_API = "http://supervisor"
SUPERVISOR_CORE = "http://supervisor/core/api"
API_TIMEOUT = ClientTimeout(total=30)

#: Background check cadence (seconds) and first-check delay after startup.
CHECK_INTERVAL = 30 * 60
CHECK_DELAY = 20

_VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class UpdateError(Exception):
    """Raised when an update cannot be started or the check fails."""


def parse_version(raw: str | None) -> tuple[int, int, int] | None:
    """``"v0.2.1"`` / ``"0.2.1"`` → ``(0, 2, 1)``; ``None`` when unparseable."""
    if not raw:
        return None
    match = _VERSION_RE.search(str(raw))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def version_label(raw: str | None) -> str | None:
    """Normalize a tag/version to a bare ``x.y.z`` label."""
    if not raw:
        return None
    match = _VERSION_RE.search(str(raw))
    return match.group(0) if match else str(raw).strip()


def newer(candidate: str | None, current: str | None) -> bool:
    """True when ``candidate`` is a newer x.y.z than ``current``."""
    cand = parse_version(candidate)
    curr = parse_version(current)
    if cand is None or curr is None:
        return False
    return cand > curr


def _iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _get_json(
    session: ClientSession, url: str, headers: dict[str, str] | None = None
) -> Any:
    async with session.get(url, headers=headers, timeout=API_TIMEOUT) as resp:
        if resp.status >= 400:
            text = await resp.text()
            raise UpdateError(f"GET {url} returned {resp.status}: {text[:200]}")
        return await resp.json()


async def _post(
    session: ClientSession,
    url: str,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
) -> Any:
    """POST with optional JSON body. Returns the parsed body; raises on 4xx/5xx."""
    async with session.post(url, headers=headers, json=json_body, timeout=API_TIMEOUT) as resp:
        if resp.status >= 400:
            text = await resp.text()
            raise UpdateError(f"POST {url} returned {resp.status}: {text[:200]}")
        try:
            return await resp.json()
        except Exception:  # noqa: BLE001 — some endpoints answer with empty bodies
            return None


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def supervisor_update_state(session: ClientSession, token: str) -> dict[str, Any] | None:
    """Read this app's version data from the Supervisor (``/addons/self/info``)."""
    info = await _get_json(
        session, f"{SUPERVISOR_API}/addons/self/info", _auth_headers(token)
    )
    # Supervisor wraps responses in {"result": "ok", "data": {...}}.
    # The self endpoint already identifies this app; installed slugs include
    # a repository hash (e.g. abc123_github_sync), not just github_sync.
    if not isinstance(info, dict) or info.get("result") != "ok":
        raise UpdateError("Supervisor returned an unsuccessful response")
    info = info.get("data")
    if not isinstance(info, dict):
        raise UpdateError("Supervisor returned invalid app information")
    current = version_label(info.get("version")) or __version__
    latest = version_label(info.get("version_latest"))
    if latest is None:
        return None
    # Prefer the Supervisor's own flag; recompute as a fallback.
    if isinstance(info.get("update_available"), bool):
        available = bool(info["update_available"])
    else:
        available = newer(latest, current)
    return {
        "current_version": current,
        "latest_version": latest,
        "update_available": available,
        "source": "supervisor",
        "detached": bool(info.get("detached")),
        "checked_at": _iso_now(),
    }


async def github_update_state(
    session: ClientSession, token: str | None = None, repo: str | None = None
) -> dict[str, Any] | None:
    """Check against the public GitHub release of this app's repo."""
    target_repo = repo or APP_REPO
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    latest = await _get_json(
        session, f"https://api.github.com/repos/{target_repo}/releases/latest", headers=headers
    )
    version = version_label(latest.get("tag_name") if isinstance(latest, dict) else None)
    if not version:
        return None
    return {
        "current_version": __version__,
        "latest_version": version,
        "update_available": newer(version, __version__),
        "source": "github",
        "detached": False,
        "checked_at": _iso_now(),
    }


def _find_update_entity(
    states: list[dict[str, Any]], expected_latest: str | None = None
) -> dict[str, Any] | None:
    """Locate this app's ``update`` entity in a Core ``/api/states`` payload.

    The hassio integration creates an update entity per installed app; its
    ``title`` attribute is the app name. Matching on title (plus, when known,
    the expected latest version) is stable across Home Assistant versions.
    """
    name = APP_NAME.strip().lower()
    # Fallback entity_id guess (Home Assistant slugifies the entity name).
    slug_id = "update." + re.sub(r"[^a-z0-9]+", "_", name).strip("_")
    candidates: list[dict[str, Any]] = []
    for state in states:
        entity_id = state.get("entity_id") or ""
        if not entity_id.startswith("update."):
            continue
        attributes = state.get("attributes") or {}
        if "latest_version" not in attributes and "installed_version" not in attributes:
            continue  # not an update entity
        title = str(attributes.get("title") or "").strip().lower()
        if title:
            if title != name:
                continue
        elif entity_id != slug_id:
            continue  # unattributed update entity — only trust the slug match
        candidates.append(state)
    if not candidates:
        return None
    if expected_latest:
        for state in candidates:
            if version_label((state.get("attributes") or {}).get("latest_version")) == version_label(
                expected_latest
            ):
                return state
    return candidates[0]


async def update_app_via_core(
    session: ClientSession, expected_latest: str | None = None
) -> dict[str, Any]:
    """Trigger this app's update through Home Assistant Core.

    The Supervisor refuses apps updating themselves, so the update is
    performed by Core's update entity (hassio integration) which has the
    Supervisor permissions. This app is allowed to call Core services because
    of ``homeassistant_api: true`` in ``config.yaml``.
    """
    token = supervisor_token()
    if not token:
        raise UpdateError(
            "No Supervisor token is available (the app must run under Home "
            "Assistant with homeassistant_api enabled). Update from the App store instead."
        )
    headers = _auth_headers(token)
    try:
        states = await _get_json(session, f"{SUPERVISOR_CORE}/states", headers)
    except (ClientError, TimeoutError) as err:
        raise UpdateError(
            f"Cannot reach Home Assistant to start the update: {err}"
        ) from err
    entity = _find_update_entity(states if isinstance(states, list) else [], expected_latest)
    if entity is None:
        raise UpdateError(
            "No Home Assistant update entry for this app was found. Update it "
            "from Settings → Apps (App store) or the Updates dashboard instead."
        )
    entity_id = entity["entity_id"]
    try:
        await _post(
            session,
            f"{SUPERVISOR_CORE}/services/update/install",
            headers,
            json_body={"entity_id": entity_id},
        )
    except (ClientError, TimeoutError):
        # Home Assistant blocks while the Supervisor redownloads and restarts
        # this container, so the response is often lost. If Core accepted the
        # call far enough, assume the update is running — the UI polls until
        # the app comes back with the new version.
        _LOGGER.info("Update service call did not answer (app is likely restarting now)")
        return {
            "ok": True,
            "message": "Update started — the app is restarting.",
            "update_entity": entity_id,
        }
    return {
        "ok": True,
        "message": "Update started — the app will restart with the new version.",
        "update_entity": entity_id,
    }


class UpdateChecker:
    """Cached, rate-limited update check with a background loop."""

    def __init__(
        self,
        session: ClientSession,
        store: Any,
        interval: float = CHECK_INTERVAL,
    ) -> None:
        self.session = session
        self.store = store
        self.interval = interval
        self._state: dict[str, Any] | None = None
        self._last_attempt: float = 0.0
        self._lock = asyncio.Lock()

    # -- state -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        if self._state is not None:
            return dict(self._state)
        return {
            "current_version": __version__,
            "latest_version": None,
            "update_available": False,
            "source": None,
            "detached": None,
            "checked_at": None,
            "supervisor": bool(supervisor_token()),
            "error": None,
        }

    def _is_fresh(self) -> bool:
        if self._state is None:
            return False
        return (time.time() - self._last_attempt) < self.interval

    # -- checking ----------------------------------------------------------

    async def check(self, force: bool = False) -> dict[str, Any]:
        async with self._lock:
            if not force and self._is_fresh():
                return dict(self._state)
            self._last_attempt = time.time()
            state = self.snapshot()
            state["error"] = None
            state["warning"] = None
            token = supervisor_token()
            state["supervisor"] = bool(token)
            sv_result: dict[str, Any] | None = None
            gh_result: dict[str, Any] | None = None

            if token:
                if force:
                    try:
                        await _post(self.session, f"{SUPERVISOR_API}/store/reload", _auth_headers(token))
                    except Exception as err:
                        _LOGGER.debug("Supervisor store reload failed (continuing check): %s", err)
                try:
                    sv_result = await supervisor_update_state(self.session, token)
                except (ClientError, TimeoutError, UpdateError) as err:
                    state["error"] = f"Supervisor update check failed: {err}"
                    _LOGGER.debug("Supervisor update check failed: %s", err)

            try:
                gh_token = self.store.data.get("access_token") or None
                gh_result = await github_update_state(self.session, token=gh_token)
            except (ClientError, TimeoutError, UpdateError) as err:
                _LOGGER.debug("GitHub update check failed: %s", err)
                if not sv_result:
                    state["error"] = (state.get("error") or "Update check failed") + f" ({err})"

            if sv_result and gh_result:
                # If GitHub has a newer release that Supervisor hasn't cached yet, prefer GitHub
                if newer(gh_result.get("latest_version"), sv_result.get("latest_version")):
                    curr = sv_result.get("current_version") or state.get("current_version") or __version__
                    state.update(gh_result)
                    state["current_version"] = curr
                else:
                    state.update(sv_result)
            elif sv_result:
                state.update(sv_result)
            elif gh_result:
                state.update(gh_result)

            checked = bool(sv_result or gh_result)
            if checked:
                state["warning"] = state.get("error") if gh_result and not sv_result and token else None
                state["error"] = None
                latest = state.get("latest_version")
                current = state.get("current_version") or __version__
                if state.get("source") == "supervisor" and sv_result and isinstance(sv_result.get("update_available"), bool):
                    state["update_available"] = sv_result["update_available"]
                else:
                    state["update_available"] = newer(latest, current)
            else:
                state["update_available"] = False
                if not state.get("error"):
                    state["error"] = "No update source is available."

            self._state = state
            await self._persist()
            if checked:
                await self._maybe_notify()
            return dict(state)

    # -- persistence + notifications ---------------------------------------

    def _meta(self) -> dict[str, Any]:
        meta = self.store.data.get("update_check")
        if not isinstance(meta, dict):
            meta = {}
            self.store.data["update_check"] = meta
        return meta

    async def _persist(self) -> None:
        meta = self._meta()
        state = self._state or {}
        meta["checked_at"] = state.get("checked_at")
        meta["latest_version"] = state.get("latest_version")
        meta["source"] = state.get("source")
        try:
            await self.store.save()
        except Exception:  # noqa: BLE001 — metadata is best-effort
            _LOGGER.debug("Could not persist update check metadata")

    async def _maybe_notify(self) -> None:
        state = self._state or {}
        latest = state.get("latest_version")
        if not state.get("update_available") or not latest:
            return
        meta = self._meta()
        if meta.get("notified_version") == latest:
            return
        meta["notified_version"] = latest
        try:
            await self.store.save()
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Could not persist update notification marker")
        await notify_ha(
            self.session,
            title="GitHub Sync update available",
            message=(
                f"Version {latest} is available (you have {state.get('current_version')}). "
                "Open GitHub Sync in the sidebar and press Update now."
            ),
            notification_id="github_sync_update_available",
        )

    # -- background loop -----------------------------------------------------

    async def loop(self) -> None:
        await asyncio.sleep(CHECK_DELAY)
        while True:
            try:
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Background update check failed")
            await asyncio.sleep(self.interval)


def current_version() -> str:
    """Version this process is running (kept in sync with config.yaml)."""
    return __version__
