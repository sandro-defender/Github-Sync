# Agent instructions

This repository is a **Home Assistant App** (formerly add-on), slug `github_sync`. It is **not** a HACS custom integration.

**Read `ROADMAP.md` first** — especially the **Handoff for the next agent** section. It has current version, what works, and the next tasks.

## Session / git

- Stay on the `arena/…` branch assigned by the current session. Do not create or push other branches.
- Push only to that branch. Open/update PR against `main`.
- After every meaningful change: update README + CHANGELOG + ROADMAP, then **commit** with a detailed message (what, why, user impact). Never `wip` / `update`.

## Required on every change

1. **README.md** — install (App store), token scopes, mounts, UI, auto-sync, and sync behaviour.
2. **CHANGELOG.md** — detailed bullet under `[Unreleased]` or the version being shipped.
3. **ROADMAP.md** — tick tasks, move phase status, refresh the handoff block.
4. **Commit** the change (the user asked to stage every change).

## Layout

- App store metadata: `repository.yaml` at the repo root.
- One app folder: `github_sync/` (Supervisor finds `config.yaml` here). Store artwork (`icon.png`, `logo.png`), option translations (`translations/`), `README.md` (store intro) and `DOCS.md` live here too.
- Runtime: `github_sync/app/` (`main.py`, `store.py`, `sync.py`, `scheduler.py`, `ha.py`, `progress.py`, `paths.py`, `ignore.py`, `github_client.py`).
- UI: `github_sync/app/static/` — Preact + signals + htm, **no build step**. `index.html` loads `assets/app/main.js`; modules live in `static/app/` (state, actions, api, format, ui, views) and the vendored runtime in `static/lib/`.
  - **Relative URLs only** (`api/status`, `assets/app/…`, `./hooks.module.js`) because Ingress prefixes the path.
  - Never assign `innerHTML` or use `dangerouslySetInnerHTML` — Preact escapes values; a test enforces this.
  - Re-vendor the runtime with `.github/scripts/vendor_frontend.sh`; keep `static/lib/README.md` checksums in sync.
- Tests: `tests/` with `PYTHONPATH=github_sync/app`; frontend tests run in Node with `tests/dom_stub.cjs`.
- Store/publish docs: `docs/store-submission.md`, `.github/workflows/publish.yml`.
- Do **not** add `custom_components/` or `hacs.json`. Do **not** add an npm/Node build pipeline — the panel must stay dependency-free at runtime and work offline.

## Versioning

- Version is `github_sync/config.yaml` → `version`. Keep the Dockerfile `io.hass.version` label and `github_sync/app/version.py` `__version__` identical.
- `.github/scripts/prepare_release.py` bumps all three files together on release; the release workflow commits `config.yaml`, `Dockerfile`, `version.py`, and `CHANGELOG.md`.
- Merges to `main` run `.github/workflows/release.yml`.

## Implementation notes

- No Home Assistant Core Python imports. This process is a container.
- File I/O via `asyncio.to_thread`. GitHub via `aiohttp`.
- Never return the access token, OAuth client secret, or `file_shas` over HTTP.
- Never allow browse/sync outside Supervisor mounts (`paths.resolve_under_roots`).
- Bind the server to `0.0.0.0:8099`.
- Auto-sync: `scheduler.py` ticks every 30s; mapping fields `auto_sync`, `auto_interval_minutes` (min 5), `auto_direction`.
- HA notifications: `ha.py` + `homeassistant_api: true` in `config.yaml`. No-op without `SUPERVISOR_TOKEN`.
- Pre-built images: `.github/workflows/publish.yml` publishes `ghcr.io/sandro-defender/{arch}-github_sync` + the multi-arch manifest. Only set `image:` in `config.yaml` after `.github/scripts/check_published_images.sh <version>` passes for every line — a missing manifest makes installs fail instead of falling back to a local build.
- Store artwork: normalise new art with `.github/scripts/optimize_store_assets.py` (icon 128×128, logo 250×100).

## How to run tests

```
PYTHONPATH=github_sync/app python3 -m unittest discover -s tests -v
node --test tests/test_frontend.cjs
```

Install `tests/requirements.txt` first (runtime dependencies plus `httpx` for API regression tests). The frontend suite renders the real Preact app into `tests/dom_stub.cjs` with a fake `fetch` — add a test there for any UI change.

Syntax-check a module (plain `node --check file.js` would parse ESM as CommonJS):

```
node --input-type=module --check - < github_sync/app/static/app/main.js
```

## Do not

- Turn this back into a HACS integration unless the user asks.
- Require a `git` CLI for sync (Git Data API only).
- Commit secrets, PATs, or `/data/github_sync.json`.
