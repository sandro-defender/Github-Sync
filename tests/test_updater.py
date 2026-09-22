"""Update check and self-update tests (no network, fake aiohttp session)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp import ClientConnectionError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

import updater  # noqa: E402
from updater import (  # noqa: E402
    UpdateChecker,
    UpdateError,
    _find_update_entity,
    github_update_state,
    newer,
    parse_version,
    supervisor_update_state,
    update_app_via_core,
    version_label,
)

SV_SELF_INFO = "http://supervisor/addons/self/info"
CORE_STATES = "http://supervisor/core/api/states"
CORE_INSTALL = "http://supervisor/core/api/services/update/install"

GH_LATEST = "https://api.github.com/repos/sandro-defender/Github-Sync/releases/latest"


class FakeResponse:
    status = 200

    def __init__(self, payload: object) -> None:
        self.payload = payload

    async def __aenter__(self) -> "FakeResponse":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def json(self) -> object:
        return self.payload

    async def text(self) -> str:
        return json.dumps(self.payload)


class FakeSession:
    """Duck-typed aiohttp ClientSession driven by a URL→payload map."""

    def __init__(self, routes: dict[str, object]) -> None:
        self.routes = routes
        self.calls: list[dict] = []

    def _respond(self, method: str, url: str, headers: dict | None, body: object) -> FakeResponse:
        self.calls.append({"method": method, "url": url, "headers": headers or {}, "body": body})
        if url not in self.routes:
            raise ClientConnectionError(f"no route for {url}")
        target = self.routes[url]
        if isinstance(target, Exception):
            raise target
        return FakeResponse(target)

    def get(self, url: str, **kwargs: object) -> FakeResponse:
        return self._respond("GET", url, kwargs.get("headers"), None)  # type: ignore[arg-type]

    def post(self, url: str, **kwargs: object) -> FakeResponse:
        return self._respond(
            "POST", url, kwargs.get("headers"), kwargs.get("json")  # type: ignore[arg-type]
        )


def self_info(
    version: str = "0.2.1",
    version_latest: str | None = "0.2.2",
    update_available: bool | None = None,
) -> dict:
    info: dict = {
        "slug": "a1b2c3_github_sync",
        "name": "GitHub Sync",
        "version": version,
        "version_latest": version_latest,
        "repository": "https://github.com/sandro-defender/Github-Sync",
        "detached": False,
    }
    if update_available is not None:
        info["update_available"] = update_available
    return {"result": "ok", "data": info}


def update_entity(title: str = "GitHub Sync", latest: str | None = "0.2.2", entity_id: str | None = None) -> dict:
    return {
        "entity_id": entity_id or f"update.{title.lower().replace(' ', '_')}",
        "state": "on" if latest else "off",
        "attributes": {
            "title": title,
            "latest_version": latest,
            "installed_version": "0.2.1",
            "friendly_name": title,
        },
    }


class VersionHelperTests(unittest.TestCase):
    def test_parse_version(self) -> None:
        self.assertEqual(parse_version("0.2.1"), (0, 2, 1))
        self.assertEqual(parse_version("v1.10.3"), (1, 10, 3))
        self.assertIsNone(parse_version("garbage"))
        self.assertIsNone(parse_version(None))

    def test_version_label(self) -> None:
        self.assertEqual(version_label("v0.2.2"), "0.2.2")
        self.assertEqual(version_label("1.0.0"), "1.0.0")
        self.assertIsNone(version_label(None))
        self.assertIsNone(version_label(""))

    def test_newer(self) -> None:
        self.assertTrue(newer("0.2.2", "0.2.1"))
        self.assertTrue(newer("v0.10.0", "0.9.9"))
        self.assertFalse(newer("0.2.1", "0.2.1"))
        self.assertFalse(newer("0.1.0", "1.0.0"))
        self.assertFalse(newer(None, "0.1.0"))
        self.assertFalse(newer("weird", "0.1.0"))


class SupervisorSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_newer_version(self) -> None:
        session = FakeSession({SV_SELF_INFO: self_info()})
        state = await supervisor_update_state(session, "tok")
        assert state is not None
        self.assertEqual(state["source"], "supervisor")
        self.assertEqual(state["current_version"], "0.2.1")
        self.assertEqual(state["latest_version"], "0.2.2")
        self.assertTrue(state["update_available"])
        self.assertFalse(state["detached"])
        # Bearer token for the Supervisor API.
        self.assertEqual(session.calls[0]["headers"]["Authorization"], "Bearer tok")

    async def test_same_version_is_not_an_update(self) -> None:
        session = FakeSession({SV_SELF_INFO: self_info(version_latest="0.2.1")})
        state = await supervisor_update_state(session, "tok")
        assert state is not None
        self.assertFalse(state["update_available"])

    async def test_trusts_supervisor_update_available_flag(self) -> None:
        # Supervisor says no update (e.g. detached local app) even though the
        # raw versions could look different.
        session = FakeSession(
            {SV_SELF_INFO: self_info(version="0.1.0", version_latest="0.2.0", update_available=False)}
        )
        state = await supervisor_update_state(session, "tok")
        assert state is not None
        self.assertFalse(state["update_available"])

    async def test_invalid_envelope_rejected(self) -> None:
        for payload in ({"result": "error", "message": "Forbidden"}, {"result": "ok", "data": []}):
            with self.assertRaises(UpdateError):
                await supervisor_update_state(FakeSession({SV_SELF_INFO: payload}), "tok")

    async def test_missing_latest_version_returns_none(self) -> None:
        session = FakeSession({SV_SELF_INFO: self_info(version_latest=None)})
        self.assertIsNone(await supervisor_update_state(session, "tok"))


class GithubSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_releases_latest(self) -> None:
        session = FakeSession({GH_LATEST: {"tag_name": "v9.3.0"}})
        state = await github_update_state(session)
        assert state is not None
        self.assertEqual(state["source"], "github")
        self.assertEqual(state["latest_version"], "9.3.0")
        self.assertEqual(state["current_version"], updater.__version__)
        self.assertTrue(state["update_available"])

    async def test_missing_tag_returns_none(self) -> None:
        session = FakeSession({GH_LATEST: {"tag_name": None}})
        self.assertIsNone(await github_update_state(session))


class FindUpdateEntityTests(unittest.TestCase):
    def test_matches_by_title(self) -> None:
        states = [
            {"entity_id": "update.ssh_and_webserver", "attributes": {"title": "SSH & Webserver", "latest_version": "1.0"}},
            update_entity(),
        ]
        entity = _find_update_entity(states)
        assert entity is not None
        self.assertEqual(entity["entity_id"], "update.github_sync")

    def test_prefers_expected_latest_version(self) -> None:
        states = [
            update_entity(entity_id="update.github_sync"),
            update_entity(entity_id="update.github_sync_copy", latest="0.9.0"),
        ]
        entity = _find_update_entity(states, expected_latest="0.2.2")
        assert entity is not None
        self.assertEqual(entity["entity_id"], "update.github_sync")

    def test_ignores_other_domains_and_titles(self) -> None:
        states = [
            {"entity_id": "light.kitchen", "attributes": {"title": "GitHub Sync"}},
            {"entity_id": "update.other_app", "attributes": {"title": "Other App", "latest_version": "2.0"}},
        ]
        self.assertIsNone(_find_update_entity(states))

    def test_case_insensitive_title(self) -> None:
        states = [update_entity(title="github sync")]
        entity = _find_update_entity(states)
        assert entity is not None
        self.assertTrue(entity["entity_id"].startswith("update."))

    def test_ignores_untitled_update_entities(self) -> None:
        states = [
            {"entity_id": "update.something", "attributes": {"latest_version": "1.0"}},
            update_entity(),
        ]
        entity = _find_update_entity(states)
        assert entity is not None
        self.assertEqual(entity["entity_id"], "update.github_sync")

    def test_untitled_entity_matched_by_slug_entity_id(self) -> None:
        states = [
            {
                "entity_id": "update.github_sync",
                "state": "on",
                "attributes": {"latest_version": "0.2.2", "installed_version": "0.2.1"},
            }
        ]
        entity = _find_update_entity(states)
        assert entity is not None
        self.assertEqual(entity["entity_id"], "update.github_sync")


class TriggerUpdateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._saved_token = os.environ.get("SUPERVISOR_TOKEN")
        os.environ["SUPERVISOR_TOKEN"] = "tok"

    def tearDown(self) -> None:
        if self._saved_token is None:
            os.environ.pop("SUPERVISOR_TOKEN", None)
        else:
            os.environ["SUPERVISOR_TOKEN"] = self._saved_token

    async def test_triggers_core_update_service(self) -> None:
        session = FakeSession(
            {
                CORE_STATES: [update_entity()],
                CORE_INSTALL: [update_entity()],
            }
        )
        result = await update_app_via_core(session, expected_latest="0.2.2")
        self.assertTrue(result["ok"])
        self.assertEqual(result["update_entity"], "update.github_sync")
        install = [call for call in session.calls if call["url"] == CORE_INSTALL]
        self.assertEqual(len(install), 1)
        self.assertEqual(install[0]["body"], {"entity_id": "update.github_sync"})
        self.assertEqual(install[0]["headers"]["Authorization"], "Bearer tok")

    async def test_without_token_raises(self) -> None:
        os.environ.pop("SUPERVISOR_TOKEN", None)
        with self.assertRaises(UpdateError):
            await update_app_via_core(FakeSession({}))

    async def test_missing_entity_raises_with_fallback_hint(self) -> None:
        session = FakeSession({CORE_STATES: []})
        with self.assertRaises(UpdateError) as ctx:
            await update_app_via_core(session)
        self.assertIn("App store", str(ctx.exception))

    async def test_connection_drop_means_restarting(self) -> None:
        session = FakeSession(
            {
                CORE_STATES: [update_entity()],
                CORE_INSTALL: ClientConnectionError("connection reset"),
            }
        )
        result = await update_app_via_core(session)
        self.assertTrue(result["ok"])
        self.assertIn("restarting", result["message"])


class _RecordingNotif:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def __call__(self, session: object, **kwargs: object) -> None:
        self.calls.append(kwargs)  # type: ignore[arg-type]


class CheckerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._saved = {
            key: os.environ.get(key)
            for key in ("SUPERVISOR_TOKEN", "GITHUB_SYNC_DATA")
        }
        os.environ["GITHUB_SYNC_DATA"] = str(Path(self._tmp.name) / "data.json")
        self.notif = _RecordingNotif()

    def tearDown(self) -> None:
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    async def _make_checker(
        self, routes: dict[str, object]
    ) -> tuple[UpdateChecker, dict, FakeSession]:
        from store import Store

        store = Store()
        await store.load()
        session = FakeSession(routes)
        with mock.patch.object(updater, "notify_ha", new=self.notif):
            checker = UpdateChecker(session, store, interval=10 * 60 * 60)
            state = await checker.check()
        return checker, state, session

    async def test_supervisor_check_and_notification_once(self) -> None:
        os.environ["SUPERVISOR_TOKEN"] = "tok"
        session = FakeSession({SV_SELF_INFO: self_info()})
        from store import Store

        store = Store()
        await store.load()
        with mock.patch.object(updater, "notify_ha", new=self.notif):
            checker = UpdateChecker(session, store, interval=10 * 60 * 60)
            state = await checker.check()
            self.assertEqual(state["source"], "supervisor")
            self.assertTrue(state["update_available"])
            self.assertEqual(len(self.notif.calls), 1)
            self.assertEqual(self.notif.calls[0]["notification_id"], "github_sync_update_available")
            # Second cached check: no network, no duplicate notification.
            calls_before = len(session.calls)
            state2 = await checker.check()
            self.assertEqual(len(session.calls), calls_before)
            self.assertEqual(len(self.notif.calls), 1)
            # Forced check re-queries but does not re-notify for same version.
            await checker.check(force=True)
            self.assertEqual(len(self.notif.calls), 1)
            self.assertTrue(state2["update_available"])
        self.assertEqual(store.data["update_check"]["notified_version"], "0.2.2")

    async def test_no_update_no_notification(self) -> None:
        os.environ["SUPERVISOR_TOKEN"] = "tok"
        _, state, _ = await self._make_checker({SV_SELF_INFO: self_info(version_latest="0.2.1")})
        self.assertFalse(state["update_available"])
        self.assertEqual(len(self.notif.calls), 0)

    async def test_falls_back_to_github_when_supervisor_unavailable(self) -> None:
        os.environ["SUPERVISOR_TOKEN"] = "tok"
        routes = {
            SV_SELF_INFO: ClientConnectionError("supervisor down"),
            GH_LATEST: {"tag_name": "v9.2.3"},
        }
        _, state, _ = await self._make_checker(routes)
        self.assertEqual(state["source"], "github")
        self.assertEqual(state["latest_version"], "9.2.3")
        self.assertTrue(state["update_available"])
        self.assertIsNone(state["error"])
        self.assertIn("Supervisor update check failed", state["warning"])

    async def test_error_clears_after_recovery(self) -> None:
        os.environ["SUPERVISOR_TOKEN"] = "tok"
        checker, state, session = await self._make_checker({
            SV_SELF_INFO: UpdateError("403: Forbidden"),
            GH_LATEST: ClientConnectionError("offline"),
        })
        self.assertIsNotNone(state["error"])
        session.routes[SV_SELF_INFO] = self_info()
        with mock.patch.object(updater, "notify_ha", new=self.notif):
            state = await checker.check(force=True)
        self.assertIsNone(state["error"])
        self.assertIsNone(state["warning"])
        self.assertEqual(state["source"], "supervisor")

    async def test_github_when_no_supervisor_token(self) -> None:
        os.environ.pop("SUPERVISOR_TOKEN", None)
        routes = {GH_LATEST: {"tag_name": "v9.9.9"}}
        _, state, _ = await self._make_checker(routes)
        self.assertEqual(state["source"], "github")
        self.assertFalse(state["supervisor"])
        self.assertTrue(state["update_available"])

    async def test_all_sources_fail_yields_error(self) -> None:
        os.environ.pop("SUPERVISOR_TOKEN", None)
        routes = {GH_LATEST: ClientConnectionError("boom")}
        _, state, _ = await self._make_checker(routes)
        self.assertFalse(state["update_available"])
        self.assertIsNone(state["latest_version"])
        self.assertIn("Update check failed", state["error"])


if __name__ == "__main__":
    unittest.main()
