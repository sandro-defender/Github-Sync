"""Sandboxed filesystem helpers for Supervisor-mounted directories."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from ignore import IgnoreMatcher

ALWAYS_IGNORE = ".git/"
MAX_FILE_SIZE = 50 * 1024 * 1024
MAX_WALK_FILES = 20000

DEFAULT_MOUNTS = (
    ("homeassistant", "/homeassistant"),
    ("share", "/share"),
    ("media", "/media"),
    ("backup", "/backup"),
    ("addons", "/addons"),
    ("addon_configs", "/addon_configs"),
)


class PathError(Exception):
    """Invalid or unsafe path."""


def discover_roots() -> dict[str, Path]:
    """Return mount name → path for directories that exist."""
    env = os.environ.get("GITHUB_SYNC_ROOTS")
    roots: dict[str, Path] = {}
    if env:
        for item in env.split(","):
            if ":" not in item:
                continue
            name, raw = item.split(":", 1)
            path = Path(raw).resolve()
            if path.is_dir():
                roots[name.strip()] = path
        if roots:
            return roots
    for name, raw in DEFAULT_MOUNTS:
        path = Path(raw)
        if path.is_dir():
            roots[name] = path.resolve()
    return roots


def parse_virtual(rel: str | None) -> tuple[str | None, str]:
    """Split 'homeassistant/esphome' into ('homeassistant', 'esphome')."""
    text = (rel or "").strip().strip("/")
    if not text:
        return None, ""
    parts = text.split("/", 1)
    return parts[0], parts[1] if len(parts) > 1 else ""


def resolve_under_roots(roots: dict[str, Path], rel: str | None) -> Path:
    """Resolve a virtual path and keep it inside a known root."""
    if not roots:
        raise PathError("No Home Assistant folders are mounted into this app")
    mount, rest = parse_virtual(rel)
    if mount is None:
        raise PathError("Choose a folder")
    if mount not in roots:
        raise PathError(f"Unknown location: {mount}")
    root = roots[mount]
    candidate = root if not rest else (root / rest)
    resolved = Path(os.path.realpath(candidate))
    try:
        resolved.relative_to(Path(os.path.realpath(root)))
    except ValueError as err:
        raise PathError("Path is outside the allowed Home Assistant folders") from err
    return resolved


def to_virtual(roots: dict[str, Path], path: Path) -> str:
    """Return mount/relative POSIX path."""
    real = Path(os.path.realpath(path))
    for name, root in roots.items():
        try:
            rel = real.relative_to(Path(os.path.realpath(root)))
        except ValueError:
            continue
        posix = rel.as_posix()
        return name if posix == "." else f"{name}/{posix}"
    raise PathError("Path is outside the allowed Home Assistant folders")


def browse_directory(roots: dict[str, Path], rel_path: str | None) -> dict[str, Any]:
    """List a directory (blocking I/O). Empty path lists mounts."""
    text = (rel_path or "").strip().strip("/")
    if not text:
        entries = []
        for name, path in roots.items():
            entries.append(
                {
                    "name": name,
                    "path": name,
                    "is_dir": True,
                    "is_symlink": False,
                    "size": None,
                }
            )
        return {"path": "", "parent": None, "root": "Home Assistant", "entries": entries}

    target = resolve_under_roots(roots, text)
    if not target.exists():
        raise PathError("Folder does not exist")
    if not target.is_dir():
        raise PathError("Path is not a folder")

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError as err:
        raise PathError(f"Cannot read folder: {err}") from err

    for child in children:
        try:
            is_dir = child.is_dir()
            is_symlink = child.is_symlink()
            if is_symlink:
                try:
                    resolve_under_roots(roots, to_virtual(roots, child))
                except PathError:
                    continue
            size = None if is_dir else int(child.stat().st_size)
        except OSError:
            continue
        entries.append(
            {
                "name": child.name,
                "path": to_virtual(roots, child),
                "is_dir": is_dir,
                "is_symlink": is_symlink,
                "size": size,
            }
        )

    virtual = to_virtual(roots, target)
    parent = None
    if "/" in virtual:
        parent = virtual.rsplit("/", 1)[0]
    elif virtual:
        parent = ""

    return {
        "path": virtual,
        "parent": parent,
        "root": str(target),
        "entries": entries,
    }


def collect_files(
    roots: dict[str, Path],
    rel_dir: str,
    matcher: IgnoreMatcher,
    limit: int = MAX_WALK_FILES,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """Walk a folder and split files into included / excluded."""
    root_folder = resolve_under_roots(roots, rel_dir)
    if not root_folder.is_dir():
        raise PathError("Folder does not exist")

    included: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    truncated = False
    always = IgnoreMatcher(ALWAYS_IGNORE)

    for dirpath, dirnames, filenames in os.walk(root_folder, followlinks=False):
        current = Path(dirpath)
        rel_current = current.relative_to(root_folder).as_posix()
        if rel_current == ".":
            rel_current = ""

        keep_dirs: list[str] = []
        for name in dirnames:
            rel = f"{rel_current}/{name}".strip("/") if rel_current else name
            if always.is_ignored(rel, True):
                excluded.append(
                    {
                        "path": rel,
                        "is_dir": True,
                        "size": 0,
                        "pattern": matcher.matching_pattern(rel, True) or ALWAYS_IGNORE.strip(),
                        # Hard-coded exclusion: the UI hides these rows because
                        # ticking them can never re-include the folder.
                        "always_ignored": True,
                    }
                )
                continue
            if matcher.is_ignored(rel, True) and not matcher.has_negations:
                # Pruning is only a walk optimisation: a pruned folder's
                # children never reach the include/exclude lists. A folder
                # ignored by a catch-all rule (`*`/`**`, e.g. from the UI's
                # "Uncheck all") keeps being walked instead, so its files stay
                # visible and can be re-included individually. Hand-written
                # folder rules (`.storage/`, presets, …) keep the fast-path.
                pattern = matcher.matching_pattern(rel, True)
                excluded.append(
                    {
                        "path": rel,
                        "is_dir": True,
                        "size": 0,
                        "pattern": pattern or ALWAYS_IGNORE.strip(),
                    }
                )
                if pattern not in ("*", "**"):
                    continue
            keep_dirs.append(name)
        dirnames[:] = sorted(keep_dirs)

        for name in filenames:
            rel = f"{rel_current}/{name}".strip("/") if rel_current else name
            file_path = current / name
            try:
                size = int(file_path.stat().st_size)
            except OSError:
                continue
            if always.is_ignored(rel, False) or matcher.is_ignored(rel, False):
                excluded.append(
                    {
                        "path": rel,
                        "is_dir": False,
                        "size": size,
                        "pattern": matcher.matching_pattern(rel, False) or ALWAYS_IGNORE.strip(),
                    }
                )
                continue
            included.append(
                {
                    "path": rel,
                    "is_dir": False,
                    "size": size,
                    "too_large": size > MAX_FILE_SIZE,
                }
            )
            if len(included) + len(excluded) >= limit:
                return included, excluded, True

    return included, excluded, truncated


def read_file_bytes(path: Path) -> bytes:
    return path.read_bytes()


def write_file_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def delete_file(path: Path) -> None:
    if path.is_file() or path.is_symlink():
        path.unlink()
