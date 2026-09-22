"""Async GitHub REST / Git Data API client."""

from __future__ import annotations

import asyncio
import base64
from typing import Any, Callable

from aiohttp import ClientError, ClientSession, ClientTimeout

API_VERSION = "2022-11-28"
USER_AGENT = "HomeAssistant-GitHub-Sync-App"
BLOB_CONCURRENCY = 8


class GithubAPIError(Exception):
    """GitHub API returned an error."""


class GithubAuthError(GithubAPIError):
    """Token is missing, invalid, or lacks permission."""


class GithubNotFound(GithubAPIError):
    """Repository, ref, or object was not found."""


class GithubClient:
    """Thin async wrapper around GitHub's REST API."""

    def __init__(self, session: ClientSession, token: str, api_base: str) -> None:
        self._session = session
        self._token = token
        self.api_base = api_base.rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": USER_AGENT,
        }

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        allow_404: bool = False,
    ) -> Any:
        url = path if path.startswith("http") else f"{self.api_base}{path}"
        timeout = ClientTimeout(total=60)
        try:
            async with self._session.request(
                method,
                url,
                headers=self._headers(),
                json=json,
                params=params,
                timeout=timeout,
            ) as resp:
                if resp.status == 401:
                    raise GithubAuthError("Invalid GitHub token")
                if resp.status == 403:
                    text = await resp.text()
                    raise GithubAPIError(
                        f"GitHub denied the request (rate limit or permissions): {text[:240]}"
                    )
                if resp.status == 404:
                    if allow_404:
                        return None
                    raise GithubNotFound("GitHub resource not found")
                if resp.status == 409:
                    return None
                if resp.status >= 400:
                    text = await resp.text()
                    raise GithubAPIError(f"GitHub API error {resp.status}: {text[:300]}")
                if resp.status == 204:
                    return None
                return await resp.json()
        except (TimeoutError, ClientError) as err:
            raise GithubAPIError(f"Cannot reach GitHub: {err}") from err

    async def get_user(self) -> dict[str, Any]:
        data = await self.request("GET", "/user")
        if not data:
            raise GithubAuthError("GitHub returned an empty user profile")
        return data

    async def list_repos(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1
        while page <= 20:
            batch = await self.request(
                "GET",
                "/user/repos",
                params={
                    "per_page": 100,
                    "page": page,
                    "affiliation": "owner,collaborator,organization_member",
                    "sort": "updated",
                },
            )
            if not batch:
                break
            for repo in batch:
                items.append(
                    {
                        "full_name": repo.get("full_name"),
                        "name": repo.get("name"),
                        "owner": (repo.get("owner") or {}).get("login"),
                        "private": repo.get("private", False),
                        "default_branch": repo.get("default_branch") or "main",
                        "html_url": repo.get("html_url"),
                        "description": repo.get("description") or "",
                    }
                )
            if len(batch) < 100:
                break
            page += 1
        return items

    async def list_branches(self, owner: str, repo: str) -> list[str]:
        names: list[str] = []
        page = 1
        while page <= 10:
            batch = await self.request(
                "GET",
                f"/repos/{owner}/{repo}/branches",
                params={"per_page": 100, "page": page},
            )
            if not batch:
                break
            names.extend(item["name"] for item in batch if "name" in item)
            if len(batch) < 100:
                break
            page += 1
        return names

    async def get_ref(self, owner: str, repo: str, branch: str) -> dict[str, Any] | None:
        return await self.request(
            "GET",
            f"/repos/{owner}/{repo}/git/ref/heads/{branch}",
            allow_404=True,
        )

    async def get_commit(self, owner: str, repo: str, sha: str) -> dict[str, Any]:
        data = await self.request("GET", f"/repos/{owner}/{repo}/git/commits/{sha}")
        if not data:
            raise GithubNotFound("Commit not found")
        return data

    async def get_tree(self, owner: str, repo: str, tree_sha: str) -> dict[str, Any]:
        data = await self.request(
            "GET",
            f"/repos/{owner}/{repo}/git/trees/{tree_sha}",
            params={"recursive": "1"},
        )
        if not data:
            raise GithubNotFound("Tree not found")
        return data

    async def get_blob(self, owner: str, repo: str, sha: str) -> bytes:
        data = await self.request("GET", f"/repos/{owner}/{repo}/git/blobs/{sha}")
        if not data:
            raise GithubNotFound("Blob not found")
        content = (data.get("content") or "").replace("\n", "")
        encoding = data.get("encoding") or "base64"
        if encoding == "base64":
            return base64.b64decode(content)
        return content.encode("utf-8")

    async def create_blob(self, owner: str, repo: str, data: bytes) -> str:
        payload = {
            "content": base64.b64encode(data).decode("ascii"),
            "encoding": "base64",
        }
        result = await self.request(
            "POST", f"/repos/{owner}/{repo}/git/blobs", json=payload
        )
        sha = (result or {}).get("sha")
        if not sha:
            raise GithubAPIError("GitHub did not return a blob SHA")
        return sha

    async def create_blobs(
        self,
        owner: str,
        repo: str,
        files: list[tuple[str, bytes]],
        on_progress: Callable[[int, int, str], None] | None = None,
    ) -> dict[str, str]:
        semaphore = asyncio.Semaphore(BLOB_CONCURRENCY)
        progress_lock = asyncio.Lock()
        completed = 0
        total = len(files)

        async def _one(path: str, content: bytes) -> tuple[str, str]:
            nonlocal completed
            async with semaphore:
                sha = await self.create_blob(owner, repo, content)
            async with progress_lock:
                completed += 1
                if on_progress:
                    on_progress(completed, total, path)
            return path, sha

        results = await asyncio.gather(*(_one(path, content) for path, content in files))
        return dict(results)

    async def create_tree(self, owner: str, repo: str, entries: list[dict[str, str]]) -> str:
        result = await self.request(
            "POST", f"/repos/{owner}/{repo}/git/trees", json={"tree": entries}
        )
        sha = (result or {}).get("sha")
        if not sha:
            raise GithubAPIError("GitHub did not return a tree SHA")
        return sha

    async def create_commit(
        self,
        owner: str,
        repo: str,
        message: str,
        tree_sha: str,
        parents: list[str],
    ) -> dict[str, Any]:
        result = await self.request(
            "POST",
            f"/repos/{owner}/{repo}/git/commits",
            json={"message": message, "tree": tree_sha, "parents": parents},
        )
        if not result or "sha" not in result:
            raise GithubAPIError("GitHub did not return a commit SHA")
        return result

    async def update_ref(
        self, owner: str, repo: str, branch: str, sha: str, force: bool = False
    ) -> None:
        existing = await self.get_ref(owner, repo, branch)
        if existing is None:
            await self.request(
                "POST",
                f"/repos/{owner}/{repo}/git/refs",
                json={"ref": f"refs/heads/{branch}", "sha": sha},
            )
            return
        await self.request(
            "PATCH",
            f"/repos/{owner}/{repo}/git/refs/heads/{branch}",
            json={"sha": sha, "force": force},
        )
