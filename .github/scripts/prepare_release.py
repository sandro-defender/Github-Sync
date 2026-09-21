#!/usr/bin/env python3
"""Bump the app version and build release notes from git history."""

from __future__ import annotations

import os
import re
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "github_sync" / "config.yaml"
DOCKERFILE = ROOT / "github_sync" / "Dockerfile"
CHANGELOG = ROOT / "CHANGELOG.md"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def current_tag() -> str | None:
    try:
        return git("describe", "--tags", "--abbrev=0")
    except subprocess.CalledProcessError:
        return None


def parse_semver(raw: str) -> tuple[int, int, int]:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", raw)
    if not match:
        return (0, 0, 0)
    return tuple(int(p) for p in match.groups())  # type: ignore[return-value]


def bump(version: tuple[int, int, int], level: str) -> tuple[int, int, int]:
    major, minor, patch = version
    if level == "major":
        return (major + 1, 0, 0)
    if level == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def classify(messages: list[str]) -> str:
    body = "\n".join(messages).lower()
    if "breaking change" in body or re.search(r"^breaking:", body, re.M):
        return "major"
    if re.search(r"^feat(\(|:)", body, re.M) or "feat:" in body:
        return "minor"
    return "patch"


def commit_list(since: str | None) -> list[str]:
    rng = f"{since}..HEAD" if since else "HEAD"
    log = git("log", rng, "--pretty=format:%s")
    if not log:
        return []
    skip = ("merge pull request", "[skip release]", "[release bot]")
    lines = []
    for line in log.splitlines():
        lower = line.lower()
        if any(token in lower for token in skip):
            continue
        lines.append(line.strip())
    return lines


def read_config_version() -> str:
    match = re.search(r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?', CONFIG.read_text(), re.M)
    return match.group(1) if match else "0.1.0"


def write_version(new: str) -> None:
    config = CONFIG.read_text(encoding="utf-8")
    CONFIG.write_text(
        re.sub(r'^version:\s*.*$', f'version: "{new}"', config, count=1, flags=re.M),
        encoding="utf-8",
    )
    if DOCKERFILE.exists():
        docker = DOCKERFILE.read_text(encoding="utf-8")
        DOCKERFILE.write_text(
            re.sub(
                r'io\.hass\.version="[^"]+"',
                f'io.hass.version="{new}"',
                docker,
                count=1,
            ),
            encoding="utf-8",
        )


def prepend_changelog(version: str, bullets: list[str]) -> str:
    today = date.today().isoformat()
    notes = "\n".join(f"- {item}" for item in bullets) or "- Maintenance release."
    block = f"## [{version}] - {today}\n\n{notes}\n"
    existing = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else "# Changelog\n"
    if existing.lstrip().startswith("#"):
        parts = existing.split("\n", 1)
        rest = parts[1] if len(parts) > 1 else ""
        CHANGELOG.write_text(f"{parts[0]}\n\n{block}\n{rest.lstrip()}", encoding="utf-8")
    else:
        CHANGELOG.write_text(f"# Changelog\n\n{block}\n{existing}", encoding="utf-8")
    return notes


def main() -> None:
    manifest_version = read_config_version()
    tag = current_tag()
    messages = commit_list(tag)
    if tag is None:
        new_version = manifest_version
        level = "initial"
    else:
        level = classify(messages)
        new_version = ".".join(str(p) for p in bump(parse_semver(tag), level))
        write_version(new_version)

    bullets = messages or [f"Release {new_version} of GitHub Sync for Home Assistant."]
    existing = CHANGELOG.read_text(encoding="utf-8") if CHANGELOG.exists() else ""
    if f"## [{new_version}]" in existing:
        notes = "\n".join(f"- {item}" for item in bullets)
    else:
        notes = prepend_changelog(new_version, bullets)

    notes_path = ROOT / ".github" / "release-notes.md"
    notes_path.write_text(notes + "\n", encoding="utf-8")

    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"version={new_version}\n")
            handle.write(f"tag=v{new_version}\n")
            handle.write(f"level={level}\n")
    print(f"Prepared release {new_version} ({level})")


if __name__ == "__main__":
    main()
