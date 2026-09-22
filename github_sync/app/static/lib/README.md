# Vendored frontend runtime

The Ingress panel must work with **no build step and no network access**, so the
browser dependencies are committed here as plain ES modules. Home Assistant
loads `assets/app/main.js` directly; that module imports these files relatively
(no import map, no bundler, no CDN).

Re-vendor after a version bump:

```bash
.github/scripts/vendor_frontend.sh            # versions via env vars
PREACT_VERSION=10.28.0 .github/scripts/vendor_frontend.sh
```

The script downloads the npm tarballs, extracts the ESM builds, rewrites bare
specifiers (`preact`, `preact/hooks`, `@preact/signals-core`) to the sibling
files here, copies the licenses and prints the checksums below.

| File | Package | Version | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `preact.module.js` | [preact](https://www.npmjs.com/package/preact) | 10.27.2 | MIT (`LICENSE-preact.txt`) | `a1cefabf06ec626adcb92731537e1e04fd09a7908e22551bab50540106dc950d` |
| `hooks.module.js` | [preact/hooks](https://www.npmjs.com/package/preact) | 10.27.2 | MIT (`LICENSE-preact.txt`) | `59197e80cf93d09fc08a84183aa250c3fbb20ae5d24f7f2beef1ae0538ca30bf` |
| `signals-core.module.js` | [@preact/signals-core](https://www.npmjs.com/package/@preact/signals-core) | 1.12.1 | MIT (`LICENSE-signals-core.txt`) | `a2261b3791bb800e7b268783e459a362f5da84f9c038be9b9509f3a6c632ad34` |
| `signals.module.js` | [@preact/signals](https://www.npmjs.com/package/@preact/signals) | 2.5.1 | MIT (`LICENSE-signals.txt`) | `cb04aa90676586fd00aae81e5f724ce65b6b13a50159fb546be539f238ac7633` |
| `htm.module.js` | [htm](https://www.npmjs.com/package/htm) | 3.1.1 | Apache-2.0 (`LICENSE-htm.txt`) | `ab33dd3f38059b9be4d5f5350128eefb2356639c4e0bbe9d9e8b3ba75847e9e4` |

Total shipped size: roughly 24 KB (minified ESM, uncompressed).

## What each library does here

- **preact** — component runtime (`h`, `render`, `Fragment`, `Component`).
- **preact/hooks** — `useState`, `useEffect`, `useRef`, `useErrorBoundary`, ….
- **@preact/signals** — reactive state (`signal`, `computed`) with automatic
  component re-rendering; `static/app/state.js` is the single store.
- **htm** — tagged-template JSX replacement bound to `h` in `static/app/deps.js`,
  so views read like JSX without a compiler.

## Maintenance rules

1. Never edit the vendored files by hand — re-run the script.
2. Keep the checksums in this table in sync with the script output.
3. The whole set is MIT/Apache-2.0; keep the license files next to the modules.
4. CI parses every module in `static/lib/` and `static/app/` and fails on a
   syntax error, so a broken vendor drop cannot ship.
