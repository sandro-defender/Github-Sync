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

**Session branch:** `arena/01a0c6f9-github-sync` (stay on the branch provided by your Arena session).
**Base version:** `0.3.2` in config.yaml, Dockerfile and version.py. Release automation bumps all three on merge.
**Current work:** PR #7 merged and released as **v0.4.0** (merge commit `8d31027`): the sidebar UI is now a Preact component app (vendored ESM runtime, no build step, dark-first design system) and the store/release readiness work landed (multi-arch publish workflow, verification script, normalised artwork, de/es/fr/it translations, app-folder README, `docs/store-submission.md`). The release workflow dispatched the image build, which published `ghcr.io/sandro-defender/{aarch64,amd64}-github_sync:0.4.0` and the multi-arch `ghcr.io/sandro-defender/github_sync:0.4.0`/`:latest`. This session's next PR enables `image:` in `config.yaml` so installs stop building locally.
**Validation:** the publish workflow built and pushed both architectures plus the manifest for 0.4.0 (all four jobs green); 81 Python tests and 11 frontend render tests passing (the frontend suite mounts the real app in Node via `tests/dom_stub.cjs`), plus an ESM syntax check over every shipped module. Still **not** verified on real hardware: Supervisor/device approval, a real app install, auto-sync denials, and the first GHCR publish run. The sandbox cannot reach ghcr.io, so the publish workflow has not been executed yet.

**What works today**

- Install as a custom App store repository (`repository.yaml` + `github_sync/`); store artwork is now 128×128 icon / 250×100 logo (39 KB total).
- **Modern sidebar UI** (Preact 10 + signals + htm, vendored under `static/lib/`, wired in `static/app/deps.js`): mapping search, status dots, filter chips on diffs, toasts, skeletons, keyboard-accessible dialogs with a dry-run preview one click away, error boundary, module layout `state.js` / `actions.js` / `api.js` / `format.js` / `ui.js` / `views/`.
- Ingress sidebar: token, mappings, file browser, gitignore editor, Check / Upload / Download.
- **Configurable GitHub access:** choose read-only/read-write and selected repositories before device login; choose OAuth scope, or connect a fine-grained token for GitHub-enforced restrictions. Settings can narrow existing connections; policies cover manual/automatic operations and Git Data writes. Logout clears local credentials, not GitHub grants.
- Conflict snapshots (`last_sync.file_shas`) capped at 5000 entries with a `file_shas_truncated` flag.
- Auto-sync per mapping (15 min / hourly / 6h / daily; upload, download, or check-only) plus a persistent HA notification on failure.
- Progress text polled by the UI during long jobs (`GET api/progress`), including completed upload blobs.
- **Dry runs:** Upload/Download confirmation offers a read-only plan with create/overwrite/delete counts — no persisted metadata, no notifications, no writes.
- **In-app update check + one-click update** through Home Assistant's update entity (the Supervisor forbids self-updates), with a version chip, Settings card, banner and HA notification.
- **Publish pipeline** `.github/workflows/publish.yml` → `ghcr.io/sandro-defender/{arch}-github_sync` + multi-arch manifest; verify with `.github/scripts/check_published_images.sh <version>` before setting `image:`.
- Supervisor option translations: en, de, es, fr, it.
- Tests: `PYTHONPATH=github_sync/app python3 -m unittest discover -s tests -v` and `node --test tests/test_frontend.cjs`; CI runs both plus an ESM syntax check over `static/app/**` and `static/lib/**`.

**Do not**

- Add `custom_components/` or `hacs.json`. This is an App, not a HACS integration.
- Switch git branches. Stay on the `arena/…` branch your session was given.
- Put the GitHub token in API responses or in `config.yaml` options.
- Use a `git` CLI; keep the Git Data API.
- Add an npm/Node build step to the UI — the panel must stay offline-capable and dependency-free at runtime (vendor instead, see `static/lib/README.md`).
- Set `image:` in `config.yaml` before the matching GHCR manifest exists.

**Next work (Phase 11 → 12)**

1. Verify on a real HA OS/Supervised install: install/update flow (now pulling a pre-built image), device authorization, fine-grained read-only repos, auto-sync denial, dry-run previews, and the panel on mobile + light theme (checklist in `docs/store-submission.md`).
2. Confirm the 0.4.0 GHCR manifests with `.github/scripts/check_published_images.sh 0.4.0`, then merge the follow-up PR that sets `image:` in `config.yaml`.
3. Further sync hardening: preserve Git tree modes/non-blob entries, improve large-blob handling and concurrency protections.
4. Optional extras: an AppArmor profile, German/French/Spanish/Italian *UI* strings, per-mapping sync history view.
5. Submit to a curated app store once 1–2 are done (`docs/store-submission.md` has the practical path).

**Local run**

```
GITHUB_SYNC_DATA=/tmp/github-sync-data.json \
GITHUB_SYNC_ROOTS=workspace:/absolute/path \
python3 -m uvicorn main:app --host 0.0.0.0 --port 8099
```

Working directory: `github_sync/app`. Frontend fetch paths are relative (`api/status`).

---

## Current status

**Active phase:** 12 (store readiness and published images)

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
| 12 | Modern UI, publishing & store readiness | In progress |

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
- [x] Connect GitHub from the app UI via selectable device scopes or a fine-grained token (device popup with auto-copied code + approval link; clickable `@username` menu with options, switch account, log out)
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

## Phase 7 — Sidebar UI (rewritten in Phase 12)

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
- [x] Dry-run mode that never writes
- [x] Per-blob upload progress
- [x] Multi-arch image publish workflow + verification script (enabling `image:` waits for the first successful GHCR run)
- [ ] Submit to community app store when stable (requirements, checklist and submission path documented in `docs/store-submission.md`)
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

- [x] Dry-run mode that never writes.
- [x] Multi-arch image pipeline: `.github/workflows/publish.yml` (Home Assistant builder actions, GHCR, `{arch}` images + multi-arch manifest) and `.github/scripts/check_published_images.sh` to gate enabling `image:` in `config.yaml`.
- [x] Pipeline validated in CI: pull-request runs build `amd64` and `aarch64` images (~1m35s each) without pushing, so the Dockerfile and builder inputs are proven before merge (PR #7 checks).
- [x] Release ordering fixed: `release.yml` dispatches the image publish after the version bump, so image tags match the released version.
- [x] Publish workflow ran on `main` after the version bump and pushed both architecture images plus the multi-arch manifest for 0.4.0.
- [ ] Verify the registry entries from a machine with ghcr.io access (`.github/scripts/check_published_images.sh 0.4.0`) and flip the three GHCR packages to **public** (GitHub default is private; one-time UI step, no API) — the sandbox can reach neither ghcr.io nor the package API, so this is the one unverified step.
- [ ] Merge the follow-up PR #8 (pins `image:` in `config.yaml`) once that check is green.
- [x] Cap or prune `file_shas` snapshots if `/data/github_sync.json` grows large.
- [x] Translations beyond English for Supervisor options (de, es, fr, it).
- [x] Store preparation: artwork within the presentation guidelines (icon 128×128, logo 250×100), app-folder `README.md` intro, and `docs/store-submission.md` with the requirement checklist + device verification list.
- [ ] Submit to the community App store when stable.

---

## Phase 12 — Modern UI, publishing & store readiness

- [x] Rewrite the Ingress panel as a component app (Preact + signals + htm) with no build step.
- [x] Vendor the runtime as ESM (`static/lib/`, checksums + re-vendor script) so the panel works offline with no CDN.
- [x] Split the frontend into state / actions / api / format / ui / views and delete the old single-file renderer.
- [x] Design system: dark-first palette, gradient accents, glass surfaces, automatic light theme, reduced-motion support.
- [x] UX: instant mapping search, diff filter chips, wizard stepper, toast stack, skeletons, busy progress bar, keyboard/aria-accessible dialogs, error boundary.
- [x] Render-based frontend test suite (`tests/test_frontend.cjs` + `tests/dom_stub.cjs`) and ESM syntax checks in CI.
- [x] Multi-arch publish workflow and image verification script.
- [x] Store artwork normalisation script and de/es/fr/it option translations.
- [x] Pull-request build mode: both architectures build in CI without pushing (it caught the JSON-quoted `image:` regression before merge).
- [x] First GHCR publish run (0.4.0, both architectures + manifest).
- [ ] Enable `image:` in `config.yaml` — change prepared in this session's follow-up PR; merge after the registry check passes. Expect a short (<5 min) window right after that merge where a new release's image is still building.
- [ ] Device verification checklist on a real Home Assistant installation.

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
    access.py                   repository allowlist and read/write validation
    oauth.py                    GitHub device flow with selectable scopes and flow-bound access policy
    ignore.py
    paths.py
    sync.py
    scheduler.py                30s tick, per-mapping interval
    progress.py
    ha.py                       Supervisor persistent_notification
    updater.py                  app self-update check + update trigger
    version.py                  runtime version (synced with config.yaml)
    static/
      index.html                panel shell + ESM entry
      styles.css                design system (dark first + light theme)
      lib/                      vendored Preact/signals/htm (ESM, no CDN)
      app/
        main.js                 mount + first load
        deps.js                 runtime wiring (html template + hooks + signals)
        state.js                signals store
        actions.js              API flows (sync, auth, updates)
        api.js                  fetch wrapper with typed errors
        format.js               display helpers
        ui.js                   design-system primitives
        views/                  shell, header, mappings, editor, diff, settings, dialogs
tests/                          unittest, PYTHONPATH=github_sync/app
                                + Node render tests (test_frontend.cjs, dom_stub.cjs)
docs/store-submission.md       store requirements, image rollout, submission path
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
5. Merges to `main` create a GitHub Release and publish the multi-arch app image.
