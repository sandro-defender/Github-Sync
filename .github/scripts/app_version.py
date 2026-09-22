#!/usr/bin/env python3
"""Read and write the single app version used by GitHub Sync.

Three files must always carry the same version:

* ``github_sync/config.yaml``  -> ``version:`` (what the Supervisor advertises)
* ``github_sync/Dockerfile``   -> ``io.hass.version`` label
* ``github_sync/app/version.py`` -> ``__version__`` (what the running app reports)

``prepare_release.py`` imports :func:`write_version` when it bumps a release, and
``.github/workflows/publish.yml`` calls this file directly so an image can be
built for a version that has not been committed yet (see ``release.yml``, which
publishes the image *before* it advertises the new version).

Usage::

    python3 .github/scripts/app_version.py            # print the config version
    python3 .github/scripts/app_version.py 0.5.1      # write 0.5.1 everywhere
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "github_sync" / "config.yaml"
DOCKERFILE = ROOT / "github_sync" / "Dockerfile"
VERSION_PY = ROOT / "github_sync" / "app" / "version.py"

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


class VersionError(RuntimeError):
    """Raised when a version string or one of the version files is unusable."""


def read_config_version() -> str:
    """Return ``version:`` from the app manifest."""
    if not CONFIG.exists():
        raise VersionError(f"missing app manifest: {CONFIG}")
    match = re.search(r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?', CONFIG.read_text(), re.M)
    if not match:
        raise VersionError(f"could not read a version from {CONFIG}")
    return match.group(1)


def current_versions() -> dict[str, str | None]:
    """Return every place the version is stored, for logging and drift checks."""
    found: dict[str, str | None] = {"config.yaml": None, "Dockerfile": None, "version.py": None}
    if CONFIG.exists():
        match = re.search(r'^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+)"?', CONFIG.read_text(), re.M)
        found["config.yaml"] = match.group(1) if match else None
    if DOCKERFILE.exists():
        match = re.search(r'io\.hass\.version="([^"]+)"', DOCKERFILE.read_text())
        found["Dockerfile"] = match.group(1) if match else None
    if VERSION_PY.exists():
        match = re.search(r'__version__\s*=\s*"([^"]+)"', VERSION_PY.read_text())
        found["version.py"] = match.group(1) if match else None
    return found


def write_version(new: str) -> list[str]:
    """Write ``new`` into every version file and return the files that changed."""
    if not VERSION_RE.match(new or ""):
        raise VersionError(f"not a x.y.z version: {new!r}")
    if not CONFIG.exists():
        raise VersionError(f"missing app manifest: {CONFIG}")

    changed: list[str] = []

    config = CONFIG.read_text(encoding="utf-8")
    updated = re.sub(r"^version:\s*.*$", f'version: "{new}"', config, count=1, flags=re.M)
    if updated != config:
        CONFIG.write_text(updated, encoding="utf-8")
        changed.append(str(CONFIG.relative_to(ROOT)))

    if DOCKERFILE.exists():
        docker = DOCKERFILE.read_text(encoding="utf-8")
        updated = re.sub(
            r'io\.hass\.version="[^"]+"',
            f'io.hass.version="{new}"',
            docker,
            count=1,
        )
        if updated != docker:
            DOCKERFILE.write_text(updated, encoding="utf-8")
            changed.append(str(DOCKERFILE.relative_to(ROOT)))

    if VERSION_PY.exists():
        version_py = VERSION_PY.read_text(encoding="utf-8")
        updated = re.sub(
            r'__version__\s*=\s*"[^"]+"',
            f'__version__ = "{new}"',
            version_py,
            count=1,
        )
        if updated != version_py:
            VERSION_PY.write_text(updated, encoding="utf-8")
            changed.append(str(VERSION_PY.relative_to(ROOT)))

    return changed


def main(argv: list[str]) -> int:
    if not argv:
        print(read_config_version())
        return 0

    new = argv[0].strip()
    try:
        before = current_versions()
        changed = write_version(new)
    except VersionError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    after = current_versions()
    print(f"App version: {new}")
    for label, value in after.items():
        previous = before.get(label)
        note = "" if previous == value else f"  (was {previous or 'missing'})"
        print(f"  {label:<12} {value}{note}")
    if not changed:
        print("Nothing to do — every file already carried this version.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
