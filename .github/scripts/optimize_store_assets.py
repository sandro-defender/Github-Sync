#!/usr/bin/env python3
"""Normalise the App Store artwork in `github_sync/`.

Home Assistant's presentation guidelines recommend:

* `icon.png` — square, 128x128 px
* `logo.png` — around 250x100 px

New artwork usually arrives much larger (the source files were 1536x1536 and
2880x1440), which bloats the container and the store page. This script scales
them down, keeps the logo aspect ratio intact by padding, and strips metadata.

Usage:
    pip install pillow
    python .github/scripts/optimize_store_assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - developer convenience
    sys.exit("Pillow is required: pip install pillow")

APP_DIR = Path(__file__).resolve().parents[2] / "github_sync"

ICON_SIZE = (128, 128)
LOGO_SIZE = (250, 100)


def _save(image: "Image.Image", path: Path) -> None:
    image.save(path, format="PNG", optimize=True)


def normalize_icon(path: Path) -> str:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        # Crop to a centered square first so non-square art is not squashed.
        side = min(image.size)
        left = (image.width - side) // 2
        top = (image.height - side) // 2
        image = image.crop((left, top, left + side, top + side)).resize(ICON_SIZE, Image.LANCZOS)
        _save(image, path)
    return f"{path.name}: {ICON_SIZE[0]}x{ICON_SIZE[1]} ({path.stat().st_size:,} bytes)"


def normalize_logo(path: Path) -> str:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        image.thumbnail(LOGO_SIZE, Image.LANCZOS)
        canvas = Image.new("RGBA", LOGO_SIZE, (0, 0, 0, 0))
        canvas.paste(image, ((LOGO_SIZE[0] - image.width) // 2, (LOGO_SIZE[1] - image.height) // 2))
        _save(canvas, path)
    return f"{path.name}: {LOGO_SIZE[0]}x{LOGO_SIZE[1]} ({path.stat().st_size:,} bytes)"


def main() -> int:
    for name, handler in (("icon.png", normalize_icon), ("logo.png", normalize_logo)):
        target = APP_DIR / name
        if not target.exists():
            print(f"skip {name}: not found", file=sys.stderr)
            continue
        print(handler(target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
