"""Gitignore-style path matching for upload and download filters."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class IgnoreRule:
    """A single gitignore pattern."""

    original: str
    negate: bool
    directory_only: bool
    regex: re.Pattern[str]


def _translate_segment(glob: str) -> str:
    """Translate a gitignore glob (no unescaped slash handling) to a regex."""
    out: list[str] = []
    i = 0
    length = len(glob)
    while i < length:
        char = glob[i]
        if char == "*":
            if i + 1 < length and glob[i + 1] == "*":
                # ** matches across directories
                if i + 2 < length and glob[i + 2] == "/":
                    out.append("(?:.*/)?")
                    i += 3
                    continue
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
            i += 1
            continue
        if char == "?":
            out.append("[^/]")
            i += 1
            continue
        if char == "[":
            j = i + 1
            if j < length and glob[j] in ("!", "^"):
                j += 1
            if j < length and glob[j] == "]":
                j += 1
            while j < length and glob[j] != "]":
                j += 1
            if j >= length:
                out.append(re.escape(char))
                i += 1
                continue
            cls = glob[i + 1 : j]
            if cls.startswith("!") or cls.startswith("^"):
                cls = "^" + cls[1:]
            out.append("[" + cls + "]")
            i = j + 1
            continue
        out.append(re.escape(char))
        i += 1
    return "".join(out)


def _compile_pattern(pattern: str) -> re.Pattern[str]:
    """Compile a gitignore pattern (without bang / trailing slash) to regex."""
    anchored = pattern.startswith("/")
    if anchored:
        pattern = pattern[1:]

    # A slash anywhere except a trailing one (already stripped) means match
    # relative to the root of the mapping.
    match_from_root = anchored or "/" in pattern

    if pattern.startswith("**/"):
        pattern = pattern[3:]
        body = _translate_segment(pattern)
        regex = rf"(?:^|.*/){body}$"
        return re.compile(regex)

    body = _translate_segment(pattern)
    if match_from_root:
        regex = rf"^{body}$"
    else:
        regex = rf"(?:^|.*/){body}$"
    return re.compile(regex)


def parse_gitignore(text: str | None) -> list[IgnoreRule]:
    """Parse gitignore text into match rules."""
    rules: list[IgnoreRule] = []
    if not text:
        return rules

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n\r")
        if not line.strip():
            continue
        if line.lstrip().startswith("#"):
            continue
        # Preserve escaped spaces; drop unescaped trailing spaces.
        while line.endswith(" ") and not line.endswith("\\ "):
            line = line[:-1]
        original = line
        negate = line.startswith("!")
        if negate:
            line = line[1:]
        if line.startswith("\\"):
            line = line[1:]
        directory_only = line.endswith("/")
        if directory_only:
            line = line[:-1]
        if not line:
            continue
        try:
            regex = _compile_pattern(line)
        except re.error:
            continue
        rules.append(
            IgnoreRule(
                original=original,
                negate=negate,
                directory_only=directory_only,
                regex=regex,
            )
        )
    return rules


class IgnoreMatcher:
    """Match relative POSIX paths against gitignore rules."""

    def __init__(self, text: str | None, extra: str | None = None) -> None:
        combined = (extra or "") + "\n" + (text or "")
        self.rules = parse_gitignore(combined)
        self.has_negations = any(rule.negate for rule in self.rules)

    def matches_entry(self, rel_path: str, is_dir: bool) -> bool:
        """Return whether this exact path is ignored (no parent walk)."""
        path = rel_path.replace("\\", "/").strip("/")
        if not path:
            return False
        ignored = False
        for rule in self.rules:
            if rule.directory_only and not is_dir:
                continue
            if rule.regex.match(path):
                ignored = not rule.negate
        return ignored

    def is_ignored(self, rel_path: str, is_dir: bool = False) -> bool:
        """Return True if the path or any parent directory is ignored."""
        path = rel_path.replace("\\", "/").strip("/")
        if not path:
            return False
        parts = path.split("/")
        for index in range(len(parts)):
            partial = "/".join(parts[: index + 1])
            last = index == len(parts) - 1
            if self.matches_entry(partial, is_dir if last else True):
                return True
        return False

    def matching_pattern(self, rel_path: str, is_dir: bool = False) -> str | None:
        """Return the last matching pattern string, if any."""
        path = rel_path.replace("\\", "/").strip("/")
        matched: str | None = None
        parts = path.split("/")
        for index in range(len(parts)):
            partial = "/".join(parts[: index + 1])
            last = index == len(parts) - 1
            entry_is_dir = is_dir if last else True
            for rule in self.rules:
                if rule.directory_only and not entry_is_dir:
                    continue
                if rule.regex.match(partial):
                    matched = rule.original
        return matched
