# GitHub Sync — Roadmap

Living document. **Update this file whenever work starts, finishes, or is blocked.** Future agents should read this **and** `AGENTS.md` before changing code.

## Product

A **Home Assistant App** (formerly add-on) that syncs any Home Assistant folder with a GitHub repository.

This is **not** a HACS integration. Apps run as their own Supervisor container, get real filesystem mounts (`/homeassistant`, `/share`, `/media`, …), and show a full UI in the Home Assistant sidebar via **Ingress**.

- Each folder can target a **different repository** and branch.
- Sidebar UI: settings, file browser, smart `.gitignore` editor, Check / Upload / Download.
- Optional per-mapping **auto-sync** (upload / download / check-only).
- GitHub is talked to over the REST **Git Data API**. No `git` binary is required.

Requires **Home Assistant OS** or **Supervised** (Apps are not available on Container/Core).

---

## Handoff for the next agent (read this first)

**Session branch:** `arena/01a0c6e1-github-sync` (stay on the branch provided by your Arena session).
**Base version:** `0.3.1` in config.yaml, Dockerfile and version.py. Release automation bumps all three on merge.
**Current work:** Supervisor 403 fix complete (correct URL + response envelope, fallback/recovery tests); configurable GitHub access complete; dry-run previews are in progress.
**Validation:** 72 unit tests passing after access controls. Local Python environment: `.venv`.

**What works today**

- Install as a custom App store repository (`repository.yaml` + `github_sync/`).
- Ingress sidebar: token, mappings, file browser, gitignore editor, Check / Upload / Download.
- **Configurable GitHub access:** choose read-only/read-write and selected repositories before device login; choose OAuth scope, or connect a fine-grained token for GitHub-enforced restrictions. OAuth allowlists are explicitly labelled app-enforced. Settings can narrow existing connections; policies cover manual/automatic operations and Git Data writes. Legacy connections remain unrestricted until configured. Logout clears local credentials, not GitHub grants.
- Conflict snapshots (`last_sync.file_shas`) capped at 5000 entries with a `file_shas_truncated` flag (roadmap item done).
- `store.py` mapping helpers fixed (`_public_last_sync`, `_interval`, `_direction` were missing and crashed saves/lists) and covered by `tests/test_store.py`.
- Auto-sync per mapping (15 min / hourly / 6h / daily; upload, download, or check-only).
- Persistent notification in Home Assistant when a sync fails (needs Supervisor `SUPERVISOR_TOKEN`; `homeassistant_api: true`).
- Progress text polled by the UI during long jobs (`GET api/progress`), including completed upload blobs.
- Three-way **conflict** flag on Check after at least one successful upload/download (uses stored `file_shas` in `/data`, stripped from the public API).
- Download confirmation can opt into deleting local extras; it is off by default and respects download-ignore rules.
- Refreshed App Store icon and repository banner; the icon is also used in the Ingress header and browser tab.
- **In-app update check + one-click update**: background check every 30 min (Supervisor `/addons/self/info`, GitHub-release fallback), header version chip, Settings → App updates card, green banner with **Update now**, HA persistent notification once per new version. The update itself is triggered through Home Assistant's update entity (`update/install`) because the Supervisor forbids an app updating itself.
- Unit tests: `PYTHONPATH=github_sync/app python3 -m unittest discover -s tests -v` (needs `aiohttp` for `test_sync_hash` and `test_updater`).

**Do not**

- Add `custom_components/` or `hacs.json`. This is an App, not a HACS integration.
- Switch git branches. Stay on the `arena/…` branch your session was given.
- Put the GitHub token in API responses or in `config.yaml` options.
- Use a `git` CLI; keep the Git Data API.

**Next work (Phase 10)**

1. Dry-run mode that never writes — in progress in this session.
2. Publish multi-arch images and set `image:` in `config.yaml` so Supervisor does not local-build.
3. ~~Cap or prune `file_shas` snapshots if `/data/github_sync.json` grows large~~ — done (`MAX_FILE_SHAS = 5000`, truncation flag).
4. Translations beyond English for Supervisor options.
5. Submit to the community App store when stable.

**Local run**

```
GITHUB_SYNC_DATA=/tmp/github-sync-data.json \
GITHUB_SYNC_ROOTS=workspace:/absolute/path \
python3 -m uvicorn main:app --host 0.0.0.0 --port 8099
```

Working directory: `github_sync/app`. Frontend fetch paths are relative (`api/status`).

---

## Current status

**Active phase:** 11 (access controls, dry-run safety and release readiness)

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Repository foundation (App) | Done |
| 1 | App bootstrap + Ingress UI | Done |
| 2 | File browser | Done |
| 3 | Mapping management | Done |
| 4 | Smart gitignore editor | Done |
| 5 | GitHub client | Done |
| 6 | Sync engine (check / upload / download) | Done |
| 7 | Sidebar UI | Done |
| 8 | Scheduling, HA notifications, progress, conflicts | Done |
| 9 | Tests (started), store listing, multi-arch images | In progress |
| 10 | App self-update (update check + one-click update) | Done |
| 11 | Hardening & release readiness | In progress |

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
- [x] Connect GitHub from the app UI via device authorization only (popup with auto-copied code + approval link; clickable `@username` menu with options, switch account, log out)
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
- [x] App icon in the Ingress header and browser tab

## Phase 8 — Scheduling, notifications, progress

- [x] Per-mapping interval auto-sync (upload / download / check-only)
- [x] Persistent notification on failure (and on check-only when files differ)
- [x] Progress messages for long jobs (`/api/progress`)
- [x] Three-way conflict flags using last-sync `file_shas`
- [x] Per-blob upload progress while GitHub requests run concurrently

## Phase 9 — Polish

- [x] unittest for ignore matcher, path sandbox, SHA, scheduler due-dates
- [ ] Dry-run mode that never writes
- [x] Per-blob upload progress
- [ ] Publish multi-arch images (`image:` in config.yaml)
- [ ] Submit to community app store when stable
- [x] Download UI checkbox for `delete_extras` (off by default; ignored files remain protected)
- [x] Refresh App Store and repository branding assets
- [x] Cap `file_shas` conflict snapshots at 5000 entries with a truncation flag

## Phase 10 — App self-update

- [x] Fix Supervisor 403: correct self-info URL, unwrap response envelope, handle repository-prefixed slugs and clear stale errors.

- [x] Runtime version in `github_sync/app/version.py` (kept in sync with `config.yaml` + Dockerfile label by `.github/scripts/prepare_release.py`)
- [x] Background update check every 30 min (`updater.py`), first check ~20 s after start, cached + forceable
- [x] Update sources: Supervisor `/addons/self/info` (App store truth) with public GitHub-release fallback for local dev
- [x] `GET api/updates`, `POST api/updates/check`, `POST api/updates/install` endpoints
- [x] One-click **Update now** through Home Assistant's update entity (`update/install` service) — the Supervisor forbids an app updating itself
- [x] UI: header version chip, Settings → **App updates** card, green "update available" banner (dismissible per version), full-screen updating overlay with polling until the new version answers
- [x] HA persistent notification when an update is available (once per version; marker persisted in `/data`)
- [x] Unit tests: version parsing, both update sources, entity discovery, update trigger, checker cache + notification
- [x] Shipped in v0.2.2 (PR #3, merged 2026-09-22)

---

## Phase 11 — Hardening & release readiness

- [x] Configurable GitHub access, explicit OAuth limitations, optional fine-grained token, server-side enforcement and tests.

- [ ] Dry-run mode that never writes.
- [ ] Publish multi-arch images and set `image:` in `config.yaml` so Supervisor does not local-build.
- [x] Cap or prune `file_shas` snapshots if `/data/github_sync.json` grows large.
- [ ] Translations beyond English for Supervisor options.
- [ ] Submit to the community App store when stable.

---

## Architecture

```
repository.yaml                 App store metadata
github_sync/
  config.yaml                   Supervisor app manifest (version source of truth)
  Dockerfile
  run.sh
  icon.png / logo.png
  app/
    main.py                     FastAPI + Ingress
    store.py                    /data/github_sync.json
    github_client.py
    oauth.py                    GitHub device flow with selectable scopes and flow-bound access policy
    ignore.py
    paths.py
    sync.py
    scheduler.py                30s tick, per-mapping interval
    progress.py
    ha.py                       Supervisor persistent_notification
    updater.py                  app self-update check + update trigger
    version.py                  runtime version (synced with config.yaml)
    static/                     sidebar UI (relative URLs), browser icon
tests/                          unittest, PYTHONPATH=github_sync/app
```

**Data** (`/data/github_sync.json`)

- `access_token`, `api_base`, `username`, `user_id`, `access` (read/write mode and repository allowlist), `auth_method`, `requested_scope`
- `mappings[]`: folder, repo, ignore rules, auto_sync, last_sync (including private `file_shas`, capped at 5000 entries)
- `update_check`: last update-check timestamp, latest version seen, and the version already notified about

**Security**

- Sidebar is admin-only (Ingress).
- File access is limited to Supervisor-mounted directories.
- Default ignore excludes `.storage/`, `secrets.yaml`, databases, and logs.
- GitHub token stays in `/data`, never in API responses.

## Repo rules

1. Update **README.md** on every behaviour change.
2. Record every change in **CHANGELOG.md**.
3. Keep **this roadmap** in sync (including the handoff section).
4. Write detailed git commits (what, why, user impact).
5. Merges to `main` create a GitHub Release.
