# Agent instructions

This repository is a **Home Assistant App** (formerly add-on), slug `github_sync`. It is **not** a HACS custom integration.

**Read `ROADMAP.md` first** — especially the **Handoff for the next agent** section. It has current version, what works, and the next tasks.

## Session / git

- Stay on `arena/01a0c65d-github-sync`. Do not create or push other branches.
- Push only to that branch. Open/update PR against `main`.
- After every meaningful change: update README + CHANGELOG + ROADMAP, then **commit** with a detailed message (what, why, user impact). Never `wip` / `update`.

## Required on every change

1. **README.md** — install (App store), token scopes, mounts, UI, auto-sync, and sync behaviour.
2. **CHANGELOG.md** — detailed bullet under `[Unreleased]` or the version being shipped.
3. **ROADMAP.md** — tick tasks, move phase status, refresh the handoff block.
4. **Commit** the change (the user asked to stage every change).

## Layout

- App store metadata: `repository.yaml` at the repo root.
- One app folder: `github_sync/` (Supervisor finds `config.yaml` here).
- Runtime: `github_sync/app/` (`main.py`, `store.py`, `sync.py`, `scheduler.py`, `ha.py`, `progress.py`, `paths.py`, `ignore.py`, `github_client.py`).
- UI: `github_sync/app/static/` — **relative URLs only** (`api/status`, `assets/app.js`) because Ingress prefixes the path.
- Tests: `tests/` with `PYTHONPATH=github_sync/app`.
- Do **not** add `custom_components/` or `hacs.json`.

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

## How to run tests

```
PYTHONPATH=github_sync/app python3 -m unittest discover -s tests -v
```

`test_sync_hash` imports `sync.py` which needs `aiohttp` installed.

## Do not

- Turn this back into a HACS integration unless the user asks.
- Require a `git` CLI for sync (Git Data API only).
- Commit secrets, PATs, or `/data/github_sync.json`.
