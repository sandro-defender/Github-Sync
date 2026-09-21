"""GitHub Sync Home Assistant App — Ingress API and UI."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from aiohttp import ClientSession
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from github_client import GithubAPIError, GithubAuthError, GithubClient
from ignore import IgnoreMatcher
from paths import ALWAYS_IGNORE, PathError, browse_directory, collect_files, discover_roots, resolve_under_roots
from store import IGNORE_PRESETS, Store
from sync import SyncEngine, split_repo

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = Store()
    await store.load()
    session = ClientSession()
    app.state.store = store
    app.state.session = session
    app.state.roots = discover_roots()
    try:
        yield
    finally:
        await session.close()


app = FastAPI(title="GitHub Sync", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


def store() -> Store:
    return app.state.store


def roots():
    return app.state.roots


def client_or_401() -> GithubClient:
    token = store().data.get("access_token") or ""
    if not token:
        raise HTTPException(status_code=401, detail="Connect a GitHub token first")
    api_base = store().data.get("api_base") or "https://api.github.com"
    return GithubClient(app.state.session, token, api_base)


def engine() -> SyncEngine:
    return SyncEngine(client_or_401(), roots())


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
    return payload


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
    return await engine().check(mapping)


@app.post("/api/upload")
async def upload(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await engine().upload(mapping, body.get("message"))
    mapping["last_sync"] = {
        "at": result["at"],
        "direction": "upload",
        "commit_sha": result.get("commit_sha"),
        "html_url": result.get("html_url"),
        "uploaded": result.get("uploaded"),
    }
    await store().save()
    return result


@app.post("/api/download")
async def download(body: dict[str, Any]) -> dict[str, Any]:
    mapping = store().get_mapping(body.get("mapping_id") or "")
    result = await engine().download(
        mapping, bool(body.get("delete_extras", False))
    )
    mapping["last_sync"] = {
        "at": result["at"],
        "direction": "download",
        "commit_sha": result.get("commit_sha"),
        "downloaded": result.get("downloaded"),
        "deleted": result.get("deleted"),
    }
    await store().save()
    return result


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
