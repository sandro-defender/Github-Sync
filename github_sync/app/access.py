"""App-enforced GitHub access policy, distinct from GitHub token grants."""

from __future__ import annotations

import re
from typing import Any


class AccessDenied(Exception):
    """An operation is outside the user's selected app access policy."""


def repository_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Repository must be in owner/name format")
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9_.-]+", value):
        raise ValueError("Repository must be in owner/name format (no URLs or wildcards)")
    if value.split("/")[1] in (".", ".."):
        raise ValueError("Invalid repository name")
    return value.lower()


def validate_access(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("mode") not in ("read", "write"):
        raise ValueError("Choose read-only or read/write GitHub access")
    repos = value.get("repositories")
    if not isinstance(repos, list) or len(repos) > 200:
        raise ValueError("Select up to 200 repositories")
    return {"mode": value["mode"], "repositories": sorted({repository_name(r) for r in repos})}


def require_access(access: dict[str, Any] | None, repository: str, *, write: bool = False) -> None:
    name = repository_name(repository)
    # Existing installations retain access until the admin chooses restrictions.
    # An explicit empty list, unlike None, grants access to NO repositories.
    if access is None:
        return
    if name not in access["repositories"]:
        raise AccessDenied(f"{name} is not selected in GitHub access settings")
    if write and access["mode"] != "write":
        raise AccessDenied("GitHub access is read-only. Upload is disabled (including automatic uploads).")
