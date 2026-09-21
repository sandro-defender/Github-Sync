# Agent instructions

This repository is a **Home Assistant App** (formerly add-on), slug `github_sync`. It is **not** a HACS custom integration.

Read `ROADMAP.md` before making changes.

## Required on every change

1. **README.md** — install (App store), token scopes, mounts, UI, and sync behaviour.
2. **CHANGELOG.md** — detailed bullet under `[Unreleased]` or the version being shipped.
3. **ROADMAP.md** — tick tasks, move phase status, note blockers.
4. **Commit messages** — several sentences: what, why, and how a Home Assistant user sees it.

## Layout

- App store metadata: `repository.yaml` at the repo root.
- One app folder: `github_sync/` (Supervisor finds `config.yaml` here).
- Runtime code: `github_sync/app/`.
- UI: `github_sync/app/static/` (relative URLs only — Ingress prefixes the path).
- Do **not** add `custom_components/` or `hacs.json`.

## Versioning

- Version is `github_sync/config.yaml` → `version`.
- Keep Dockerfile `io.hass.version` in sync if present.
- Merges to `main` run `.github/workflows/release.yml`.

## Implementation notes

- No Home Assistant Core Python imports. This process is a container.
- File I/O via `asyncio.to_thread`. GitHub via `aiohttp`.
- Never return the access token from the HTTP API.
- Never allow browse/sync outside Supervisor mounts.
- Bind the server to `0.0.0.0:8099` (ingress_port).
- Frontend fetch paths must be relative (`api/status`, not `/api/status`).

## Do not

- Turn this back into a HACS integration unless the user asks.
- Require a `git` CLI for sync (Git Data API only).
- Commit secrets or PATs.
