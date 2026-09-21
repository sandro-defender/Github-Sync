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

from github_client import GithubAPIError, GithubAuthError, GithubClient
from ha import notify_ha
from ignore import IgnoreMatcher
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
    app.state.store = store
    app.state.session = session
    app.state.roots = discover_roots()
    app.state.progress = progress

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
    github = GithubClient(app.state.session, token, api_base)
    user = await github.get_user()
    await store().set_token(token, api_base, user.get("login"), user.get("id"))
    return store().public_status()


@app.delete("/api/token")
async def clear_token() -> dict[str, bool]:
    await store().clear_token()
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
