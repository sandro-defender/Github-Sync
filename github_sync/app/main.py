"""GitHub Sync Home Assistant App — Ingress API and UI."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from aiohttp import ClientSession
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from access import AccessDenied, require_access, validate_access
from github_client import GithubAPIError, GithubAuthError, GithubClient
from ha import notify_ha
from ignore import IgnoreMatcher
from oauth import GITHUB_API_BASE, OAuthBroker, OAuthError
from paths import (
    PathError,
    browse_directory,
    collect_files,
    collect_tree,
    discover_roots,
    resolve_under_roots,
)
from progress import ProgressHub
from scheduler import Scheduler
from store import IGNORE_PRESETS, Store
from sync import SyncEngine, cap_file_shas, split_repo
from updater import UpdateChecker, UpdateError, update_app_via_core

STATIC_DIR = Path(__file__).parent / "static"
_LOGGER = logging.getLogger("github_sync")


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = Store()
    await store.load()
    session = ClientSession()
    progress = ProgressHub()
    oauth = OAuthBroker()
    app.state.store = store
    app.state.session = session
    app.state.roots = discover_roots()
    app.state.progress = progress
    app.state.oauth = oauth

    async def run_mapping(mapping: dict[str, Any], direction: str) -> Any:
        return await _execute(mapping, direction, source="auto")

    scheduler = Scheduler(store, session, progress, run_mapping)
    app.state.scheduler = scheduler
    updates = UpdateChecker(session, store)
    app.state.updates = updates
    tasks = [
        asyncio.create_task(scheduler.loop(), name="github-sync-scheduler"),
        asyncio.create_task(updates.loop(), name="github-sync-update-checker"),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await session.close()


app = FastAPI(title="GitHub Sync", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


def store() -> Store:
    return app.state.store


def roots():
    return app.state.roots


def progress() -> ProgressHub:
    return app.state.progress


def oauth() -> OAuthBroker:
    return app.state.oauth


def client_or_401() -> GithubClient:
    token = store().data.get("access_token") or ""
    if not token:
        raise HTTPException(status_code=401, detail="Connect GitHub first")
    api_base = store().data.get("api_base") or GITHUB_API_BASE
    return GithubClient(app.state.session, token, api_base, store().data.get("access"))


def engine() -> SyncEngine:
    return SyncEngine(client_or_401(), roots(), progress())


async def _notify_failure(mapping: dict[str, Any], err: Exception) -> None:
    name = mapping.get("name") or mapping.get("local_path") or mapping.get("id")
    await notify_ha(
        app.state.session,
        title="GitHub Sync failed",
        message=f"{name}: {err}",
        notification_id=f"github_sync_{mapping.get('id')}",
    )


async def _save_validated_token(token: str, *, access: dict[str, Any], auth_method: str, requested_scope: str | None = None) -> None:
    github = GithubClient(app.state.session, token, GITHUB_API_BASE)
    user = await github.get_user()
    await store().set_token(token, user.get("login"), user.get("id"), access=access, auth_method=auth_method, requested_scope=requested_scope)


async def _execute(
    mapping: dict[str, Any],
    direction: str,
    *,
    source: str,
    message: str | None = None,
    delete_extras: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    require_access(store().data.get("access"), mapping["repository"], write=direction == "upload" and not dry_run)
    mapping_id = mapping["id"]
    progress().start(mapping_id, f"Starting {direction}…")
    try:
        sync = engine()
        if direction == "check":
            result = await sync.check(mapping)
            changes = int(result.get("upload_count") or 0) + int(result.get("download_count") or 0)
            if source == "auto" and changes:
                await notify_ha(
                    app.state.session,
                    title="GitHub Sync updates",
                    message=f"{mapping.get('name')}: {changes} file(s) differ from GitHub.",
                    notification_id=f"github_sync_check_{mapping_id}",
                )
        elif direction == "upload":
            result = await sync.upload(mapping, message, dry_run=dry_run)
        elif direction == "download":
            result = await sync.download(mapping, delete_extras=delete_extras, dry_run=dry_run)
        else:
            raise HTTPException(status_code=400, detail="Unknown direction")

        if dry_run:
            progress().finish(mapping_id)
            return result

        # Cap the conflict-detection snapshot so /data stays small (roadmap).
        capped_shas, shas_truncated, shas_total = cap_file_shas(
            result.pop("file_shas", None)
        )
        last = {
            "at": result.get("at"),
            "direction": direction if direction != "check" else "check",
            "commit_sha": result.get("commit_sha"),
            "html_url": result.get("html_url"),
            "uploaded": result.get("uploaded"),
            "downloaded": result.get("downloaded"),
            "file_shas": capped_shas,
        }
        if shas_truncated:
            last["file_shas_truncated"] = True
            last["file_shas_total"] = shas_total
        if direction != "check":
            mapping["last_sync"] = last
        mapping["last_error"] = None
        await store().save()
        progress().finish(mapping_id)
        return result
    except Exception as err:
        progress().finish(mapping_id, error=str(err))
        if not dry_run:
            mapping["last_error"] = str(err)
            await store().save()
            await _notify_failure(mapping, err)
        raise


@app.exception_handler(AccessDenied)
async def _access_error(_request: Request, exc: AccessDenied) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=403)


@app.exception_handler(ValueError)
async def _value_error(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(GithubAuthError)
async def _auth_error(_request: Request, exc: GithubAuthError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=401)


@app.exception_handler(GithubAPIError)
async def _api_error(_request: Request, exc: GithubAPIError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(PathError)
async def _path_error(_request: Request, exc: PathError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(KeyError)
async def _key_error(_request: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse({"detail": f"Unknown mapping: {exc}"}, status_code=404)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/status")
async def status() -> dict[str, Any]:
    payload = store().public_status()
    payload["roots"] = list(roots().keys())
    payload["supervisor"] = bool(__import__("os").environ.get("SUPERVISOR_TOKEN"))
    return payload


@app.get("/api/updates")
async def updates() -> dict[str, Any]:
    """Update status (cached; the background checker refreshes every 30 min)."""
    return await app.state.updates.check()


@app.post("/api/updates/check")
async def check_updates() -> dict[str, Any]:
    """Force an immediate update check."""
    return await app.state.updates.check(force=True)


@app.post("/api/updates/install")
async def install_update() -> dict[str, Any]:
    """Start the update now via Home Assistant's update entity for this app."""
    return await update_app_via_core(
        app.state.session,
        expected_latest=app.state.updates.snapshot().get("latest_version"),
    )


@app.exception_handler(UpdateError)
async def _update_error(_request: Request, exc: UpdateError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=409)


@app.get("/api/progress")
async def get_progress(mapping_id: str | None = None) -> dict[str, Any]:
    return progress().snapshot(mapping_id)


@app.post("/api/token")
async def connect_fine_grained_token(body: dict[str, Any]) -> dict[str, Any]:
    """Optional GitHub-enforced repo/permission restrictions; never echo secrets."""
    access = validate_access(body.get("access"))
    token = body.get("token")
    if not isinstance(token, str) or not token.strip().startswith("github_pat_"):
        raise HTTPException(status_code=400, detail="Use a GitHub fine-grained personal access token")
    await _save_validated_token(token.strip(), access=access, auth_method="fine_grained")
    return store().public_status()


@app.post("/api/access")
async def save_access(body: dict[str, Any]) -> dict[str, Any]:
    client_or_401()
    store().data["access"] = validate_access(body)
    await store().save()
    return store().public_status()


@app.delete("/api/token")
async def clear_token() -> dict[str, bool]:
    """Sign out: forget the GitHub account (device flow re-authorizes)."""
    await store().clear_token()
    return {"ok": True}


@app.post("/api/oauth/device/start")
async def start_device_oauth(body: dict[str, Any]) -> dict[str, Any]:
    """Freeze the selected access policy into this authorization flow."""
    try:
        return await oauth().start_device(app.state.session, scope=body.get("scope", "public_read"), access=validate_access(body.get("access")))
    except OAuthError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.post("/api/oauth/device/poll")
async def poll_device_oauth(body: dict[str, Any]) -> dict[str, Any]:
    flow_id = (body.get("flow_id") or "").strip()
    if not flow_id:
        raise HTTPException(status_code=400, detail="Device authorization flow is required")
    try:
        result = await oauth().poll_device(app.state.session, flow_id)
        if result.get("status") == "authorized":
            await _save_validated_token(
                str(result.pop("access_token")), access=result.pop("access"),
                auth_method="device", requested_scope=result.pop("scope"),
            )
            result["account"] = store().public_status()
        return result
    except OAuthError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except GithubAPIError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err


@app.delete("/api/oauth/device/{flow_id}")
async def cancel_device_oauth(flow_id: str) -> dict[str, bool]:
    oauth().cancel_device(flow_id)
    return {"ok": True}


@app.get("/api/mappings")
async def list_mappings() -> dict[str, Any]:
    return {"mappings": store().mappings()}


@app.post("/api/mappings")
async def save_mapping(body: dict[str, Any]) -> dict[str, Any]:
    local_path = (body.get("local_path") or "").strip().strip("/")
    repository = (body.get("repository") or "").strip()
    if not local_path:
        raise HTTPException(status_code=400, detail="Choose a folder to sync")
    split_repo(repository)
    require_access(store().data.get("access"), repository, write=bool(body.get("auto_sync")) and body.get("auto_direction", "upload") == "upload")
    folder = resolve_under_roots(roots(), local_path)
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail="Folder does not exist")
    mapping = await store().save_mapping(body)
    return {"mapping": mapping}


@app.delete("/api/mappings/{mapping_id}")
async def delete_mapping(mapping_id: str) -> dict[str, bool]:
    await store().delete_mapping(mapping_id)
    return {"ok": True}


@app.get("/api/browse")
async def browse(path: str = "") -> dict[str, Any]:
    return await asyncio.to_thread(browse_directory, roots(), path)


@app.post("/api/preview_ignore")
async def preview_ignore(body: dict[str, Any]) -> dict[str, Any]:
    """Flat include/exclude lists (capped) — kept as the simple preview API.

    The UI reads `api/preview_tree` instead, which answers one folder level per
    request and therefore never hides files behind these caps.
    """
    local_path = body.get("local_path") or ""
    resolve_under_roots(roots(), local_path)
    matcher = IgnoreMatcher(body.get("ignore") or "")
    included, excluded, truncated = await asyncio.to_thread(
        collect_files, roots(), local_path, matcher
    )
    return {
        "direction": body.get("direction") or "upload",
        "included": included[:500],
        "excluded": excluded[:300],
        "included_count": len(included),
        "excluded_count": len(excluded),
        "excluded_file_count": sum(1 for item in excluded if not item.get("is_dir")),
        "included_size": sum(int(item.get("size") or 0) for item in included),
        "truncated": truncated,
    }


@app.post("/api/preview_tree")
async def preview_tree(body: dict[str, Any]) -> dict[str, Any]:
    """File-explorer tree: one folder level at a time, with rollups.

    The mapping wizard uses this instead of `api/preview_ignore`: rows come
    per directory, so folders expand on click and a huge folder stays fully
    explorable (its entries are paged instead of being cut off at a global row
    cap). Every folder entry carries recursive included/excluded counts, which
    is what lets a collapsed folder show a tri-state checkbox.
    """
    local_path = body.get("local_path") or ""
    resolve_under_roots(roots(), local_path)
    matcher = IgnoreMatcher(body.get("ignore") or "")
    result = await asyncio.to_thread(
        collect_tree,
        roots(),
        local_path,
        matcher,
        levels=body.get("levels") or None,
        page_size=body.get("page_size"),
        query=str(body.get("query") or ""),
        depth=body.get("depth") or 0,
    )
    result["direction"] = body.get("direction") or "upload"
    return result


@app.get("/api/repos")
async def list_repos() -> dict[str, Any]:
    return {"repos": await client_or_401().list_repos()}


@app.get("/api/branches")
async def list_branches(repository: str) -> dict[str, Any]:
    require_access(store().data.get("access"), repository)
    owner, repo = split_repo(repository)
    return {"branches": await client_or_401().list_branches(owner, repo)}


@app.get("/api/presets")
async def presets() -> dict[str, Any]:
    return {"presets": IGNORE_PRESETS}


@app.post("/api/check")
async def check(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await _execute(mapping, "check", source="manual")
    result.pop("file_shas", None)
    return result


def _bool_option(body: dict[str, Any], key: str) -> bool:
    value = body.get(key, False)
    if not isinstance(value, bool):
        raise HTTPException(status_code=400, detail=f"{key} must be a JSON boolean")
    return value


@app.post("/api/upload")
async def upload(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await _execute(mapping, "upload", source="manual", message=body.get("message"), dry_run=_bool_option(body, "dry_run"))
    result.pop("file_shas", None)
    return result


@app.post("/api/download")
async def download(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await _execute(
        mapping,
        "download",
        source="manual",
        delete_extras=_bool_option(body, "delete_extras"),
        dry_run=_bool_option(body, "dry_run"),
    )
    result.pop("file_shas", None)
    return result


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
