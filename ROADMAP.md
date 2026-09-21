# GitHub Sync — Roadmap

Living document. **Update this file whenever work starts, finishes, or is blocked.** Future agents should read this before changing code.

## Product

A **Home Assistant App** (formerly add-on) that syncs any Home Assistant folder with a GitHub repository.

This is **not** a HACS integration. Apps run as their own Supervisor container, get real filesystem mounts (`/homeassistant`, `/share`, `/media`, …), and show a full UI in the Home Assistant sidebar via **Ingress**.

- Each folder can target a **different repository** and branch.
- Sidebar UI: settings, file browser, smart `.gitignore` editor, Check / Upload / Download.
- GitHub is talked to over the REST **Git Data API**. No `git` binary is required.

Requires **Home Assistant OS** or **Supervised** (Apps are not available on Container/Core).

## Current status

**Active phase:** 0–7 (MVP app)

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Repository foundation (App) | Done |
| 1 | App bootstrap + Ingress UI | Done |
| 2 | File browser | Done |
| 3 | Mapping management | Done |
| 4 | Smart gitignore editor | Done |
| 5 | GitHub client | Done |
| 6 | Sync engine (check / upload / download) | Done |
| 7 | Sidebar UI polish | Done |
| 8 | Scheduling, HA notifications | Planned |
| 9 | Tests, store listing, multi-arch images | Planned |

Version lives in `github_sync/config.yaml`. Merges to `main` mint a GitHub Release automatically.

---

## Phase 0 — Repository foundation

- [x] Pivot from HACS integration → Home Assistant App
- [x] `repository.yaml` so the repo can be added as an App store source
- [x] `github_sync/config.yaml`, Dockerfile, run.sh, icon, logo
- [x] `ROADMAP.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `LICENSE`
- [x] App linter workflow
- [x] Auto-release workflow on merge to `main`

## Phase 1 — App bootstrap

- [x] FastAPI server on ingress port 8099
- [x] Persistent settings in `/data` (token never sent to the browser)
- [x] Connect GitHub PAT from the app UI (plus GitHub Enterprise API URL)
- [x] Health endpoint for Supervisor watchdog
- [x] Admin-only sidebar panel (`panel_admin: true`)

## Phase 2 — File browser

- [x] Browse mounted HA directories (config, share, media, backup, addons, addon configs)
- [x] Path sandbox (no `..`, no symlink escape)
- [x] Breadcrumbs + select folder
- [x] Always skip `.git` in sync walks

## Phase 3 — Mapping management

- [x] CRUD for folder → repo mappings in `/data`
- [x] Name, local path, `owner/repo`, branch, optional repo subpath
- [x] Separate upload vs download ignore rules
- [x] Last-sync metadata

## Phase 4 — Smart gitignore editor

- [x] Gitignore matcher (globs, `**`, `/`, directory `/`, `!`)
- [x] Preset chips (HA secrets, databases, logs, Python, Node, ESPHome)
- [x] Live include/exclude preview
- [x] Checkboxes add/remove patterns

## Phase 5 — GitHub client

- [x] Async REST client (`aiohttp`)
- [x] User, repos, branches, trees, blobs, commits, refs
- [x] Empty-repository first commit
- [x] Typed 401/403/404 errors

## Phase 6 — Sync engine

- [x] Local file collect + git blob SHA compare
- [x] Check for updates
- [x] Upload (commit + update ref)
- [x] Download (write files; extras kept unless requested)
- [x] 50 MB file cap

## Phase 7 — Sidebar UI

- [x] Ingress SPA: mappings, wizard, browser, ignore editor, settings
- [x] Check / Upload / Download with confirmation
- [x] Relative URLs so Ingress path prefix works
- [x] Narrow / mobile layout

## Phase 8 — Scheduling (next)

- [ ] Per-mapping interval auto-sync
- [ ] Persistent notification on failure
- [ ] Progress for large trees
- [ ] Three-way conflicts using last-sync snapshots

## Phase 9 — Polish

- [ ] pytest for ignore + sandbox + SHA
- [ ] Publish multi-arch images (`image:` in config.yaml)
- [ ] Submit to community app store when stable

---

## Architecture

```
repository.yaml                 App store metadata
github_sync/
  config.yaml                   Supervisor app manifest
  Dockerfile
  run.sh
  icon.png / logo.png
  app/
    main.py                     FastAPI + Ingress
    store.py                    /data persistence
    github_client.py
    ignore.py
    paths.py
    sync.py
    static/                     sidebar UI
```

**Security**

- Sidebar is admin-only (Ingress).
- File access is limited to Supervisor-mounted directories.
- Default ignore excludes `.storage/`, `secrets.yaml`, databases, logs.
- GitHub token stays in `/data`, never in API responses.

## Repo rules

1. Update **README.md** on every behaviour change.
2. Record every change in **CHANGELOG.md**.
3. Keep **this roadmap** in sync.
4. Write detailed git commits (what, why, user impact).
5. Merges to `main` create a GitHub Release.
