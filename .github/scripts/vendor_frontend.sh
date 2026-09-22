#!/usr/bin/env bash
# Re-vendor the frontend runtime libraries shipped with the Ingress UI.
#
# The Home Assistant panel must work without any CDN or network access, so the
# browser dependencies are committed as plain ES modules under
# github_sync/app/static/lib/. This script downloads the exact npm tarballs,
# extracts the ESM builds, rewrites bare import specifiers to relative paths
# (browsers have no node_modules resolution) and prints SHA-256 checksums.
#
# Usage: .github/scripts/vendor_frontend.sh [output-dir]
set -euo pipefail

PREACT_VERSION="${PREACT_VERSION:-10.27.2}"
SIGNALS_CORE_VERSION="${SIGNALS_CORE_VERSION:-1.12.1}"
SIGNALS_VERSION="${SIGNALS_VERSION:-2.5.1}"
HTM_VERSION="${HTM_VERSION:-3.1.1}"

OUT="${1:-github_sync/app/static/lib}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # name version dest-file
  local name="$1" version="$2" dest="$3"
  local base="${name#@*/}"
  curl -fsSL --retry 3 --max-time 120 \
    "https://registry.npmjs.org/${name}/-/${base}-${version}.tgz" \
    -o "$TMP/${base}.tgz"
  mkdir -p "$TMP/${base}"
  tar xzf "$TMP/${base}.tgz" -C "$TMP/${base}"
  cp "$TMP/${base}/$dest" "$OUT/$4"
}

mkdir -p "$OUT"

fetch preact "$PREACT_VERSION" package/dist/preact.module.js preact.module.js
fetch preact "$PREACT_VERSION" package/hooks/dist/hooks.module.js hooks.module.js
fetch @preact/signals-core "$SIGNALS_CORE_VERSION" package/dist/signals-core.module.js signals-core.module.js
fetch @preact/signals "$SIGNALS_VERSION" package/dist/signals.module.js signals.module.js
fetch htm "$HTM_VERSION" package/dist/htm.module.js htm.module.js

# Bare specifiers -> sibling files so the browser resolves them without an
# import map (import maps are not supported by every Ingress webview).
sed -i 's|from"preact/hooks"|from"./hooks.module.js"|g; s|from"preact"|from"./preact.module.js"|g' \
  "$OUT/hooks.module.js" "$OUT/signals.module.js"
sed -i 's|from"@preact/signals-core"|from"./signals-core.module.js"|g' "$OUT/signals.module.js"

for lib in preact htm signals signals-core; do
  case "$lib" in
    preact) dir="$TMP/preact" ;;
    htm) dir="$TMP/htm" ;;
    signals) dir="$TMP/signals" ;;
    signals-core) dir="$TMP/signals-core" ;;
  esac
  cp "$dir/package/LICENSE" "$OUT/LICENSE-$lib.txt"
done

echo "Vendored frontend libraries into $OUT"
echo
echo "Checksums (record changes in github_sync/app/static/lib/README.md):"
( cd "$OUT" && sha256sum preact.module.js hooks.module.js signals-core.module.js signals.module.js htm.module.js )
