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


#: Entries one file-explorer level returns per page.
TREE_PAGE_SIZE = 200
#: Directory levels a single `collect_tree` request may answer.
TREE_MAX_LEVELS = 40
#: How many extra levels "Expand all" may open before it stops going deeper.
TREE_MAX_AUTO_LEVELS = 240
#: Upper bound on the rows of *one* level, so a single monster folder cannot
#: crowd the rest of the answer out. Counting continues past it; the level says
#: `capped: true` and the UI points at the filter.
TREE_MAX_LISTED = 5000
#: Paths a file-explorer search returns.
TREE_MAX_MATCHES = 200
#: How deep `collect_tree` descends, so a symlink loop or a pathological tree
#: cannot turn one preview into an unbounded walk.
TREE_MAX_DEPTH = 24

_ROLLUP_KEYS = (
    "files",
    "included",
    "excluded",
    "dirs",
    "ignored_dirs",
    "included_size",
)


def _listing_sort_key(item: Path) -> tuple:
    """Folders first, then by name (case-insensitive), like `browse_directory`."""
    return (not _is_dir(item), item.name.lower())


def _tree_rollup() -> dict[str, Any]:
    """Zeroed counters describing everything `collect_tree` saw in a folder."""
    return {key: 0 for key in _ROLLUP_KEYS} | {"complete": True}


def _tree_merge(into: dict[str, Any], other: dict[str, Any]) -> None:
    """Fold a child folder's rollup into its parent's."""
    for key in _ROLLUP_KEYS:
        into[key] += other.get(key, 0)
    if not other.get("complete", True):
        into["complete"] = False


def _is_dir(path: Path) -> bool:
    """`Path.is_dir()` that never raises on a broken link or a symlink loop."""
    try:
        return path.is_dir()
    except OSError:
        return False


def collect_tree(
    roots: dict[str, Path],
    rel_dir: str,
    matcher: IgnoreMatcher,
    levels: list[dict[str, Any]] | None = None,
    page_size: int = TREE_PAGE_SIZE,
    query: str = "",
    walk_limit: int = MAX_WALK_FILES,
    depth: int = 0,
    list_limit: int = TREE_MAX_LISTED,
) -> dict[str, Any]:
    """Scan a folder **one level at a time** for the file explorer.

    `levels` selects the directories whose children the caller wants
    (`[{"path": "esphome", "offset": 200, "size": 400}]`, paths relative to
    `rel_dir`); the mapping root is always answered, and `depth` auto-opens
    every folder up to that many levels below the requested ones (the UI's
    "Expand all"). Each entry carries what a tree row needs:
    files their size and the rule ignoring them, folders a *recursive rollup*
    (`files` / `included` / `excluded` / `included_size` / `dirs` /
    `ignored_dirs` / `complete`) so a collapsed folder still knows whether all,
    some or none of the files inside it are synced.

    Unlike :func:`collect_files` a response is never cut off mid-folder: a
    folder with 4 000 files is *paged* (`has_more` + `total`), which is what
    keeps every file of a huge folder reachable in the UI. Only the materialised
    listing of a level is bounded (`list_limit`, flagged as `capped`), and even
    then the counts stay exact because the walk keeps going. Folders ignored by a
    rule are only descended into when the caller opens them (or while searching),
    so huge ignored trees stay cheap; always-ignored folders (`.git`) are never
    listed nor counted. `query` switches to search mode: the walk covers
    everything and the answer is a flat `matches` list instead of levels.
    """
    root_folder = resolve_under_roots(roots, rel_dir)
    if not root_folder.is_dir():
        raise PathError("Folder does not exist")

    always = IgnoreMatcher(ALWAYS_IGNORE)
    try:
        page = max(1, min(int(page_size), TREE_PAGE_SIZE * 5))
    except (TypeError, ValueError):
        page = TREE_PAGE_SIZE
    search = str(query or "").strip().casefold()
    try:
        auto_depth = max(0, min(int(depth or 0), TREE_MAX_DEPTH))
    except (TypeError, ValueError):
        auto_depth = 0

    def _page(item: dict[str, Any], path: str = "") -> dict[str, Any]:
        try:
            offset = max(0, int(item.get("offset") or 0))
        except (TypeError, ValueError):
            offset = 0
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        window = max(1, min(size or page, page * 5))
        return {"offset": offset, "size": window, "path": path}

    # The root is always answered; an explicit entry for it still wins, so
    # "Show more" in the mapping folder itself works like any other folder.
    wanted: dict[str, dict[str, Any]] = {"": _page({})}
    for item in levels or []:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().strip("/")
        if path and any(part in ("", ".", "..") for part in path.split("/")):
            raise PathError("Unsafe relative file path")
        if path not in wanted and len(wanted) >= TREE_MAX_LEVELS:
            continue
        wanted[path] = _page(item, path)

    budget = {"left": max(1, int(walk_limit))}
    state = {"truncated": False, "listed": 0}
    capped: set[str] = set()
    children: dict[str, list[dict[str, Any]]] = {path: [] for path in wanted}
    matches: list[dict[str, Any]] = []

    def scan(rel: str, level: int, auto: int) -> dict[str, Any]:
        folder = root_folder if not rel else root_folder / rel
        rollup = _tree_rollup()
        listing = children.get(rel)
        try:
            entries = sorted(folder.iterdir(), key=_listing_sort_key)
        except OSError:
            # Unreadable (permissions, races) — report it as an incomplete
            # folder instead of failing the whole preview.
            rollup["complete"] = False
            state["truncated"] = True
            return rollup
        if level >= TREE_MAX_DEPTH:
            rollup["complete"] = False
            return rollup

        for child in entries:
            if budget["left"] <= 0:
                rollup["complete"] = False
                state["truncated"] = True
                break
            budget["left"] -= 1

            name = child.name
            child_rel = f"{rel}/{name}" if rel else name
            try:
                is_dir = child.is_dir()
                is_symlink = child.is_symlink()
            except OSError:
                continue
            if is_dir and always.is_ignored(child_rel, True):
                # `.git` is never syncable: hidden, and not counted anywhere,
                # so it can never make a folder look only partly selected.
                continue

            ignored = matcher.is_ignored(child_rel, is_dir)
            pattern = matcher.matching_pattern(child_rel, is_dir) if ignored else None
            if is_dir:
                opened = child_rel in wanted or any(w.startswith(f"{child_rel}/") for w in wanted)
                # "Expand all": keep opening folders while the caller's depth
                # budget lasts, folders that are ignored included — under a
                # catch-all rule that is exactly when they need to be reachable.
                if (
                    not opened
                    and auto > 0
                    and not is_symlink
                    and len(wanted) < TREE_MAX_AUTO_LEVELS
                ):
                    wanted[child_rel] = _page({}, child_rel)
                    children[child_rel] = []
                    opened = True
                rollup["dirs"] += 1
                if ignored:
                    rollup["ignored_dirs"] += 1
                entry: dict[str, Any] = {
                    "name": name,
                    "path": child_rel,
                    "is_dir": True,
                    "size": None,
                    "ignored": ignored,
                    "pattern": pattern,
                    "symlink": is_symlink,
                    # Symlinks are never followed by the sync, so the tree
                    # shows them as plain rows without an expander.
                    "can_open": not is_symlink,
                }
                catch_all = bool(ignored and (pattern or "") in ("*", "**"))
                if is_symlink:
                    # A link to a folder is never walked or synced, so it is
                    # listed (its rule can still be toggled) but counted as
                    # nothing — it must not make the parent look "partly
                    # excluded"; `complete` stays about scan coverage only.
                    entry.update(_tree_rollup())
                    entry["complete"] = False
                    entry["unknown"] = True
                elif opened or search or not ignored or catch_all:
                    # Descend for four reasons: the caller opened this folder
                    # (its children are asked for), we are searching, the
                    # folder is included and its file counts must be known, or
                    # it is only ignored by the catch-all `*`/`**` the UI's
                    # "Uncheck all" writes — same expansion `collect_files`
                    # does, so those files stay reachable and counted.
                    sub = scan(child_rel, level + 1, auto - 1)
                    _tree_merge(rollup, sub)
                    entry.update(sub)
                    entry["unknown"] = not sub["complete"]
                else:
                    # Ignored and collapsed: everything inside is excluded, but
                    # the individual files were not walked. The row still knows
                    # its state (unchecked) and expands on demand.
                    entry.update(_tree_rollup())
                    entry["complete"] = False
                    entry["unknown"] = True
            else:
                try:
                    size = int(child.stat().st_size)
                except OSError:
                    continue
                rollup["files"] += 1
                if ignored:
                    rollup["excluded"] += 1
                else:
                    rollup["included"] += 1
                    rollup["included_size"] += size
                entry = {
                    "name": name,
                    "path": child_rel,
                    "is_dir": False,
                    "size": size,
                    "ignored": ignored,
                    "pattern": pattern,
                    "symlink": is_symlink,
                    "too_large": not ignored and size > MAX_FILE_SIZE,
                }
            if listing is not None:
                # One level's *listing* is bounded so a monster folder cannot
                # starve the rest of the response. Counting keeps going, so the
                # rollup stays exact, and `capped` tells the UI to point at the
                # filter instead of offering a "Show more" that never ends.
                state["listed"] += 1
                if len(listing) < max(1, int(list_limit)):
                    listing.append(entry)
                else:
                    capped.add(rel)
            hit = bool(search) and search in child_rel.casefold()
            if hit and len(matches) < TREE_MAX_MATCHES:
                # Search runs over everything the walk reaches, including
                # ignored folders, so a hidden file is still one click away.
                matches.append(entry)

        return rollup

    root_rollup = scan("", 0, auto_depth)

    levels_out: dict[str, Any] = {}
    for path, page_of in wanted.items():
        listing = children[path]
        size = int(page_of["size"]) or page
        start = min(max(0, int(page_of["offset"])), len(listing))
        window = listing[start : start + size]
        levels_out[path] = {
            "path": path,
            "offset": start,
            "page_size": size,
            "total": len(listing),
            "has_more": start + size < len(listing),
            "capped": path in capped,
            "entries": window,
        }

    result: dict[str, Any] = {
        "path": str(rel_dir or "").strip("/"),
        "root": root_rollup,
        "levels": levels_out,
        "truncated": state["truncated"],
        "listed": state["listed"],
        "scanned": max(0, int(walk_limit) - budget["left"]),
        "walk_limit": int(walk_limit),
    }
    if search:
        result["search"] = {
            "query": str(query or "").strip(),
            "total": len(matches),
            "entries": matches,
            "truncated": bool(search) and state["truncated"],
        }
    return result


def read_file_bytes(path: Path) -> bytes:
    return path.read_bytes()


def write_file_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def delete_file(path: Path) -> None:
    if path.is_file() or path.is_symlink():
        path.unlink()
