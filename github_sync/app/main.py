"""GitHub Sync Home Assistant App — Ingress API and UI."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from aiohttp import ClientSession
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from github_client import GithubAPIError, GithubAuthError, GithubClient
from ha import notify_ha
from ignore import IgnoreMatcher
from oauth import OAuthBroker, OAuthError, normalize_scope, oauth_base_from_api
from paths import PathError, browse_directory, collect_files, discover_roots, resolve_under_roots
from progress import ProgressHub
from scheduler import Scheduler
from store import IGNORE_PRESETS, Store
from sync import SyncEngine, split_repo

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
    task = asyncio.create_task(scheduler.loop(), name="github-sync-scheduler")
    try:
        yield
    finally:
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
        raise HTTPException(status_code=401, detail="Connect a GitHub token first")
    api_base = store().data.get("api_base") or "https://api.github.com"
    return GithubClient(app.state.session, token, api_base)


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


async def _save_validated_token(token: str, api_base: str) -> None:
    github = GithubClient(app.state.session, token, api_base)
    user = await github.get_user()
    await store().set_token(token, api_base, user.get("login"), user.get("id"))


def _safe_return_to(value: str | None, request: Request) -> str:
    """Only redirect OAuth users back to this Ingress host or a relative path."""
    from urllib.parse import urlsplit

    candidate = (value or "/").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    parsed = urlsplit(candidate)
    hosts = {
        request.headers.get("host", ""),
        request.headers.get("x-forwarded-host", "").split(",", 1)[0].strip(),
    }
    if parsed.scheme in ("http", "https") and parsed.netloc in hosts:
        return candidate
    return "/"


async def _execute(
    mapping: dict[str, Any],
    direction: str,
    *,
    source: str,
    message: str | None = None,
    delete_extras: bool = False,
) -> dict[str, Any]:
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
            result = await sync.upload(mapping, message)
        elif direction == "download":
            result = await sync.download(mapping, delete_extras=delete_extras)
        else:
            raise HTTPException(status_code=400, detail="Unknown direction")

        last = {
            "at": result.get("at"),
            "direction": direction if direction != "check" else "check",
            "commit_sha": result.get("commit_sha"),
            "html_url": result.get("html_url"),
            "uploaded": result.get("uploaded"),
            "downloaded": result.get("downloaded"),
            "file_shas": result.pop("file_shas", None),
        }
        if direction != "check":
            mapping["last_sync"] = last
        mapping["last_error"] = None
        await store().save()
        progress().finish(mapping_id)
        return result
    except Exception as err:
        progress().finish(mapping_id, error=str(err))
        mapping["last_error"] = str(err)
        await store().save()
        await _notify_failure(mapping, err)
        raise


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


@app.get("/api/progress")
async def get_progress(mapping_id: str | None = None) -> dict[str, Any]:
    return progress().snapshot(mapping_id)


@app.post("/api/token")
async def set_token(body: dict[str, Any]) -> dict[str, Any]:
    token = (body.get("access_token") or "").strip()
    api_base = (body.get("api_base") or "https://api.github.com").strip() or "https://api.github.com"
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
    await _save_validated_token(token, api_base)
    return store().public_status()


@app.delete("/api/token")
async def clear_token() -> dict[str, bool]:
    await store().clear_token()
    return {"ok": True}


@app.post("/api/oauth/config")
async def save_oauth_config(body: dict[str, Any]) -> dict[str, Any]:
    scope = normalize_scope(body.get("scope"))
    await store().save_oauth_config(
        {
            "client_id": body.get("client_id"),
            "client_secret": body.get("client_secret"),
            "redirect_uri": body.get("redirect_uri"),
            "scope": scope,
        }
    )
    return store().public_status()


@app.post("/api/oauth/device/start")
async def start_device_oauth() -> dict[str, Any]:
    config = store().oauth_config()
    if not config["client_id"]:
        raise HTTPException(status_code=400, detail="Save a GitHub OAuth App client ID first")
    try:
        return await oauth().start_device(
            app.state.session,
            client_id=config["client_id"],
            scope=config["scope"],
            oauth_base=oauth_base_from_api(store().data.get("api_base")),
        )
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
                str(result.pop("access_token")),
                store().data.get("api_base") or "https://api.github.com",
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


@app.post("/api/oauth/web/start")
async def start_web_oauth(body: dict[str, Any], request: Request) -> dict[str, str]:
    config = store().oauth_config()
    if not config["client_id"] or not config["client_secret"]:
        raise HTTPException(status_code=400, detail="Save the OAuth App client ID and secret first")
    if not config["redirect_uri"]:
        raise HTTPException(status_code=400, detail="Save the OAuth callback URL first")
    return oauth().start_web(
        client_id=config["client_id"],
        client_secret=config["client_secret"],
        redirect_uri=config["redirect_uri"],
        return_to=_safe_return_to(body.get("return_to"), request),
        scope=config["scope"],
        oauth_base=oauth_base_from_api(store().data.get("api_base")),
    )


@app.get("/api/oauth/callback")
async def oauth_callback(
    _request: Request, code: str | None = None, state: str | None = None, error: str | None = None
):
    if error:
        return JSONResponse({"detail": f"GitHub authorization was not completed: {error}"}, status_code=400)
    if not code or not state:
        return JSONResponse({"detail": "GitHub did not return an authorization code"}, status_code=400)
    try:
        flow, token = await oauth().finish_web(app.state.session, code=code, state=state)
        await _save_validated_token(token, store().data.get("api_base") or "https://api.github.com")
        return RedirectResponse(flow.return_to)
    except OAuthError as err:
        return JSONResponse({"detail": str(err)}, status_code=400)
    except GithubAPIError as err:
        return JSONResponse({"detail": str(err)}, status_code=401)


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
        "included_size": sum(int(item.get("size") or 0) for item in included),
        "truncated": truncated,
    }


@app.get("/api/repos")
async def list_repos() -> dict[str, Any]:
    return {"repos": await client_or_401().list_repos()}


@app.get("/api/branches")
async def list_branches(repository: str) -> dict[str, Any]:
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


@app.post("/api/upload")
async def upload(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await _execute(mapping, "upload", source="manual", message=body.get("message"))
    result.pop("file_shas", None)
    return result


@app.post("/api/download")
async def download(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await _execute(
        mapping,
        "download",
        source="manual",
        delete_extras=bool(body.get("delete_extras", False)),
    )
    result.pop("file_shas", None)
    return result


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
