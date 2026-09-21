"""Compare, upload, and download a mapped folder against GitHub."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from github_client import GithubClient, GithubNotFound
from ignore import IgnoreMatcher
from paths import (
    ALWAYS_IGNORE,
    MAX_FILE_SIZE,
    PathError,
    collect_files,
    delete_file,
    read_file_bytes,
    resolve_under_roots,
    write_file_bytes,
)

DEFAULT_COMMIT_MESSAGE = "chore(ha): sync {name} from Home Assistant"


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def split_repo(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().strip("/").split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise PathError("Repository must be in owner/name format")
    return parts[0], parts[1]


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _repo_file_path(repo_path: str, relative: str) -> str:
    prefix = (repo_path or "").strip("/")
    rel = relative.strip("/")
    if prefix and rel:
        return f"{prefix}/{rel}"
    return prefix or rel


def _local_rel_from_repo(repo_path: str, remote_path: str) -> str | None:
    prefix = (repo_path or "").strip("/")
    path = remote_path.strip("/")
    if not prefix:
        return path
    if path == prefix:
        return ""
    if path.startswith(prefix + "/"):
        return path[len(prefix) + 1 :]
    return None


class SyncEngine:
    def __init__(self, client: GithubClient, roots: dict[str, Path]) -> None:
        self.client = client
        self.roots = roots

    async def _local_files(self, mapping: dict[str, Any], direction: str):
        ignore_text = (
            mapping.get("ignore_upload")
            if direction == "upload"
            else mapping.get("ignore_download")
        )
        matcher = IgnoreMatcher(ignore_text, extra=ALWAYS_IGNORE)
        included, excluded, _truncated = await asyncio.to_thread(
            collect_files, self.roots, mapping["local_path"], matcher
        )
        by_path = {item["path"]: item for item in included if not item.get("too_large")}
        skipped = [item for item in included if item.get("too_large")]
        skipped.extend(
            {**item, "reason": "ignored"} for item in excluded if not item.get("is_dir")
        )
        return by_path, skipped

    async def _remote_blobs(self, mapping: dict[str, Any]):
        owner, repo = split_repo(mapping["repository"])
        branch = mapping.get("branch") or "main"
        ref = await self.client.get_ref(owner, repo, branch)
        if not ref:
            return {}, None, None
        commit_sha = (ref.get("object") or {}).get("sha")
        if not commit_sha:
            return {}, None, None
        try:
            commit = await self.client.get_commit(owner, repo, commit_sha)
        except GithubNotFound:
            return {}, None, None
        tree_sha = (commit.get("tree") or {}).get("sha")
        if not tree_sha:
            return {}, commit_sha, None
        tree = await self.client.get_tree(owner, repo, tree_sha)
        blobs = {
            entry["path"]: entry["sha"]
            for entry in tree.get("tree") or []
            if entry.get("type") == "blob"
        }
        return blobs, commit_sha, tree_sha

    async def _hash_local(self, mapping: dict[str, Any], files: dict[str, dict[str, Any]]):
        folder = resolve_under_roots(self.roots, mapping["local_path"])

        def _hash_all() -> dict[str, str]:
            result: dict[str, str] = {}
            for rel in files:
                try:
                    data = read_file_bytes(folder / rel)
                except OSError:
                    continue
                result[rel] = git_blob_sha(data)
            return result

        return await asyncio.to_thread(_hash_all)

    async def check(self, mapping: dict[str, Any]) -> dict[str, Any]:
        local_files, skipped = await self._local_files(mapping, "upload")
        local_shas = await self._hash_local(mapping, local_files)
        remote_blobs, commit_sha, _tree = await self._remote_blobs(mapping)
        repo_path = mapping.get("repo_path") or ""

        remote_rel: dict[str, str] = {}
        for remote_path, sha in remote_blobs.items():
            rel = _local_rel_from_repo(repo_path, remote_path)
            if rel is None or rel == "":
                continue
            remote_rel[rel] = sha

        download_matcher = IgnoreMatcher(
            mapping.get("ignore_download"), extra=ALWAYS_IGNORE
        )
        added, modified, extra_local = [], [], []
        unchanged = 0

        for rel, sha in local_shas.items():
            remote_sha = remote_rel.get(rel)
            size = local_files.get(rel, {}).get("size", 0)
            item = {"path": rel, "local_sha": sha, "remote_sha": remote_sha, "size": size}
            if remote_sha is None:
                added.append(item)
            elif remote_sha != sha:
                modified.append(item)
            else:
                unchanged += 1

        for rel, sha in remote_rel.items():
            if rel in local_shas or download_matcher.is_ignored(rel, False):
                continue
            extra_local.append(
                {"path": rel, "local_sha": None, "remote_sha": sha, "size": 0}
            )

        return {
            "mapping_id": mapping["id"],
            "repository": mapping["repository"],
            "branch": mapping.get("branch") or "main",
            "commit_sha": commit_sha,
            "empty_repo": commit_sha is None,
            "added": added,
            "modified": modified,
            "removed_locally": extra_local,
            "only_remote": extra_local,
            "unchanged": unchanged,
            "skipped": [
                {
                    "path": item.get("path"),
                    "size": item.get("size"),
                    "reason": item.get("reason", "too_large"),
                }
                for item in skipped
                if not item.get("is_dir")
            ][:200],
            "upload_count": len(added) + len(modified),
            "download_count": len(modified) + len(extra_local),
        }

    async def upload(self, mapping: dict[str, Any], message: str | None = None) -> dict[str, Any]:
        owner, repo = split_repo(mapping["repository"])
        branch = mapping.get("branch") or "main"
        repo_path = mapping.get("repo_path") or ""
        local_files, skipped_large = await self._local_files(mapping, "upload")
        folder = resolve_under_roots(self.roots, mapping["local_path"])

        def _read_all() -> list[tuple[str, bytes]]:
            payload: list[tuple[str, bytes]] = []
            for rel, meta in local_files.items():
                if meta.get("too_large"):
                    continue
                data = read_file_bytes(folder / rel)
                if len(data) > MAX_FILE_SIZE:
                    continue
                payload.append((_repo_file_path(repo_path, rel), data))
            return payload

        file_bytes = await asyncio.to_thread(_read_all)
        if not file_bytes:
            raise PathError("Nothing to upload (folder empty or fully ignored)")

        blob_shas = await self.client.create_blobs(owner, repo, file_bytes)
        remote_blobs, commit_sha, _tree = await self._remote_blobs(mapping)
        prefix = repo_path.strip("/")
        new_tree: list[dict[str, str]] = []
        for path, sha in remote_blobs.items():
            if not prefix:
                continue
            if path == prefix or path.startswith(prefix + "/"):
                continue
            new_tree.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
        for path, sha in blob_shas.items():
            new_tree.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
        if not new_tree:
            raise PathError("Refusing to create an empty commit")

        tree_sha = await self.client.create_tree(owner, repo, new_tree)
        parents = [commit_sha] if commit_sha else []
        commit_message = (
            message or mapping.get("commit_message") or DEFAULT_COMMIT_MESSAGE
        ).format(
            name=mapping.get("name") or mapping["local_path"],
            folder=mapping["local_path"],
            repository=mapping["repository"],
            timestamp=_now_iso(),
        )
        commit = await self.client.create_commit(
            owner, repo, commit_message, tree_sha, parents
        )
        await self.client.update_ref(owner, repo, branch, commit["sha"])
        html = (
            commit.get("html_url")
            or f"https://github.com/{owner}/{repo}/commit/{commit['sha']}"
        )
        return {
            "mapping_id": mapping["id"],
            "direction": "upload",
            "commit_sha": commit["sha"],
            "html_url": html,
            "uploaded": len(blob_shas),
            "skipped": len(skipped_large),
            "at": _now_iso(),
        }

    async def download(
        self, mapping: dict[str, Any], delete_extras: bool = False
    ) -> dict[str, Any]:
        owner, repo = split_repo(mapping["repository"])
        repo_path = mapping.get("repo_path") or ""
        remote_blobs, commit_sha, _tree = await self._remote_blobs(mapping)
        if not commit_sha:
            raise PathError("Remote branch is empty — nothing to download")

        matcher = IgnoreMatcher(mapping.get("ignore_download"), extra=ALWAYS_IGNORE)
        folder = resolve_under_roots(self.roots, mapping["local_path"])
        local_files, _ = await self._local_files(mapping, "download")
        local_shas = await self._hash_local(mapping, local_files)

        written = 0
        skipped = 0
        for remote_path, sha in remote_blobs.items():
            rel = _local_rel_from_repo(repo_path, remote_path)
            if rel is None or rel == "":
                continue
            if matcher.is_ignored(rel, False):
                skipped += 1
                continue
            if local_shas.get(rel) == sha:
                continue
            data = await self.client.get_blob(owner, repo, sha)
            target: Path = folder / rel
            resolve_under_roots(self.roots, f"{mapping['local_path']}/{rel}")
            await asyncio.to_thread(write_file_bytes, target, data)
            written += 1

        deleted = 0
        if delete_extras:
            remote_rels = {
                rel
                for remote_path in remote_blobs
                if (rel := _local_rel_from_repo(repo_path, remote_path))
            }
            for rel in list(local_shas):
                if rel in remote_rels or matcher.is_ignored(rel, False):
                    continue
                await asyncio.to_thread(delete_file, folder / rel)
                deleted += 1

        return {
            "mapping_id": mapping["id"],
            "direction": "download",
            "commit_sha": commit_sha,
            "downloaded": written,
            "deleted": deleted,
            "skipped": skipped,
            "at": _now_iso(),
        }
