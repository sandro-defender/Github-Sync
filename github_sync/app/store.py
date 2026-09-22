"""JSON persistence for token + folder mappings."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any

DEFAULT_IGNORE_UPLOAD = """\
# Home Assistant runtime and secrets
.storage/
.cloud/
.ssh/
secrets.yaml
ip_bans.yaml
known_devices.yaml

# Databases and logs
*.log
*.log.*
*.db
*.db-shm
*.db-wal
home-assistant.log*

# Caches and deps
__pycache__/
*.pyc
.cache/
deps/
tts/
*.gz
.DS_Store
"""

DEFAULT_IGNORE_DOWNLOAD = """\
# Never overwrite local secrets on download
secrets.yaml
.storage/
.cloud/
.ssh/
"""

DEFAULT_COMMIT_MESSAGE = "chore(ha): sync {name} from Home Assistant"

IGNORE_PRESETS = {
    "ha_secrets": {
        "label": "HA secrets & storage",
        "patterns": ".storage/\n.cloud/\n.ssh/\nsecrets.yaml\nip_bans.yaml\n",
    },
    "databases": {"label": "Databases", "patterns": "*.db\n*.db-shm\n*.db-wal\n"},
    "logs": {"label": "Logs", "patterns": "*.log\n*.log.*\nhome-assistant.log*\n"},
    "python": {
        "label": "Python cache",
        "patterns": "__pycache__/\n*.pyc\n.pytest_cache/\n.mypy_cache/\n",
    },
    "node": {"label": "Node", "patterns": "node_modules/\ndist/\n.npm/\n"},
    "esphome": {"label": "ESPHome build", "patterns": ".esphome/\n*.elf\n*.bin\n"},
}


def data_path() -> Path:
    raw = os.environ.get("GITHUB_SYNC_DATA", "/data/github_sync.json")
    path = Path(raw)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class Store:
    def __init__(self) -> None:
        self.path = data_path()
        self._lock = asyncio.Lock()
        self.data: dict[str, Any] = {
            "access_token": "",
            "api_base": "https://api.github.com",
            "username": None,
            "user_id": None,
            "oauth": {
                "client_id": "",
                "client_secret": "",
                "redirect_uri": "",
                "scope": "repo",
            },
            "mappings": [],
        }

    async def load(self) -> None:
        def _read() -> dict[str, Any] | None:
            if not self.path.exists():
                return None
            return json.loads(self.path.read_text(encoding="utf-8"))

        loaded = await asyncio.to_thread(_read)
        if loaded:
            self.data.update(loaded)
            self.data.setdefault("mappings", [])
            self.data.setdefault("api_base", "https://api.github.com")
            oauth = self.data.setdefault("oauth", {})
            oauth.setdefault("client_id", "")
            oauth.setdefault("client_secret", "")
            oauth.setdefault("redirect_uri", "")
            oauth.setdefault("scope", "repo")

    async def save(self) -> None:
        payload = json.dumps(self.data, indent=2)

        def _write() -> None:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(self.path)

        async with self._lock:
            await asyncio.to_thread(_write)

    def public_status(self) -> dict[str, Any]:
        oauth = self.data.get("oauth") or {}
        return {
            "configured": bool(self.data.get("access_token")),
            "username": self.data.get("username"),
            "user_id": self.data.get("user_id"),
            "api_base": self.data.get("api_base") or "https://api.github.com",
            "mapping_count": len(self.data.get("mappings") or []),
            "oauth": {
                "client_id": oauth.get("client_id") or "",
                "client_id_configured": bool(oauth.get("client_id")),
                "client_secret_configured": bool(oauth.get("client_secret")),
                "redirect_uri": oauth.get("redirect_uri") or "",
                "scope": oauth.get("scope") if oauth.get("scope") in ("repo", "public_repo") else "repo",
            },
            "defaults": {
                "ignore_upload": DEFAULT_IGNORE_UPLOAD,
                "ignore_download": DEFAULT_IGNORE_DOWNLOAD,
            },
        }

    def mappings(self) -> list[dict[str, Any]]:
        result = []
        for mapping in self.data.get("mappings") or []:
            result.append(
                {
                    "id": mapping["id"],
                    "name": mapping.get("name") or mapping.get("local_path"),
                    "local_path": mapping.get("local_path"),
                    "repository": mapping.get("repository"),
                    "branch": mapping.get("branch") or "main",
                    "repo_path": mapping.get("repo_path") or "",
                    "ignore_upload": mapping.get("ignore_upload") or "",
                    "ignore_download": mapping.get("ignore_download") or "",
                    "commit_message": mapping.get("commit_message")
                    or DEFAULT_COMMIT_MESSAGE,
                    "last_sync": _public_last_sync(mapping.get("last_sync")),
                    "auto_sync": bool(mapping.get("auto_sync")),
                    "auto_interval_minutes": mapping.get("auto_interval_minutes") or 60,
                    "auto_direction": mapping.get("auto_direction") or "upload",
                    "last_auto_at": mapping.get("last_auto_at"),
                    "last_error": mapping.get("last_error"),
                }
            )
        return result

    def get_mapping(self, mapping_id: str) -> dict[str, Any]:
        for mapping in self.data.get("mappings") or []:
            if mapping.get("id") == mapping_id:
                return mapping
        raise KeyError(mapping_id)

    async def save_mapping(self, payload: dict[str, Any]) -> dict[str, Any]:
        mapping_id = (payload.get("id") or "").strip() or uuid.uuid4().hex[:12]
        existing = None
        for item in self.data["mappings"]:
            if item["id"] == mapping_id:
                existing = item
                break
        mapping = {
            "id": mapping_id,
            "name": (payload.get("name") or payload.get("local_path") or "").strip(),
            "local_path": (payload.get("local_path") or "").strip().strip("/"),
            "repository": (payload.get("repository") or "").strip(),
            "branch": (payload.get("branch") or "main").strip() or "main",
            "repo_path": (payload.get("repo_path") or "").strip().strip("/"),
            "ignore_upload": payload.get("ignore_upload")
            if payload.get("ignore_upload") is not None
            else (existing.get("ignore_upload") if existing else DEFAULT_IGNORE_UPLOAD),
            "ignore_download": payload.get("ignore_download")
            if payload.get("ignore_download") is not None
            else (
                existing.get("ignore_download") if existing else DEFAULT_IGNORE_DOWNLOAD
            ),
            "commit_message": payload.get("commit_message")
            or (existing.get("commit_message") if existing else DEFAULT_COMMIT_MESSAGE),
            "last_sync": existing.get("last_sync") if existing else None,
            "auto_sync": bool(payload.get("auto_sync", existing.get("auto_sync") if existing else False)),
            "auto_interval_minutes": _interval(
                payload.get("auto_interval_minutes"),
                existing.get("auto_interval_minutes") if existing else 60,
            ),
            "auto_direction": _direction(
                payload.get("auto_direction"),
                existing.get("auto_direction") if existing else "upload",
            ),
            "last_auto_at": existing.get("last_auto_at") if existing else None,
            "last_error": existing.get("last_error") if existing else None,
        }
        if existing:
            index = self.data["mappings"].index(existing)
            self.data["mappings"][index] = mapping
        else:
            self.data["mappings"].append(mapping)
        await self.save()
        return mapping

    async def delete_mapping(self, mapping_id: str) -> None:
        self.get_mapping(mapping_id)
        self.data["mappings"] = [
            item for item in self.data["mappings"] if item["id"] != mapping_id
        ]
        await self.save()

    def oauth_config(self) -> dict[str, str]:
        oauth = self.data.get("oauth") or {}
        return {
            "client_id": str(oauth.get("client_id") or ""),
            "client_secret": str(oauth.get("client_secret") or ""),
            "redirect_uri": str(oauth.get("redirect_uri") or ""),
            "scope": oauth.get("scope") if oauth.get("scope") in ("repo", "public_repo") else "repo",
        }

    async def save_oauth_config(self, payload: dict[str, Any]) -> None:
        current = self.oauth_config()
        client_id = str(payload.get("client_id") or "").strip()
        client_secret = str(payload.get("client_secret") or "").strip() or current["client_secret"]
        redirect_uri = str(payload.get("redirect_uri") or "").strip()
        scope = payload.get("scope") if payload.get("scope") in ("repo", "public_repo") else current["scope"]
        self.data["oauth"] = {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "scope": scope,
        }
        await self.save()

    async def set_token(
        self, token: str, api_base: str, username: str | None, user_id: Any
    ) -> None:
        self.data["access_token"] = token
        self.data["api_base"] = api_base or "https://api.github.com"
        self.data["username"] = username
        self.data["user_id"] = user_id
        await self.save()

    async def clear_token(self) -> None:
        self.data["access_token"] = ""
        self.data["username"] = None
        self.data["user_id"] = None
        await self.save()
