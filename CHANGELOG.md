# Changelog

## [0.3.0] - 2026-09-22

- Merge branch 'main' into arena/01a0c675-github-sync
- feat: zero-config GitHub login via built-in device-flow client
- feat: in-app update check with one-click updates

## [0.2.2] - 2026-09-22

- Add in-app update check with one-click updates (#3)

## [0.2.1] - 2026-09-22

- Add GitHub OAuth authorization choices

All notable changes to GitHub Sync are documented here.

## [Unreleased]

### Added

- **Device-code popup.** **Authorise with device code** (Settings, header, empty Mappings page) opens a popup with the short code — auto-copied to the clipboard, click to copy again — plus an **Open GitHub** approval link, live approval polling, and expiry countdown. It closes by itself once approved.
- **Clickable `@username` header menu.** While signed in, the username chip opens a GitHub menu: **GitHub options**, **Switch account**, and **Log out**. A **Connect** chip shows in the header when signed out.
- **Capped conflict snapshots (roadmap).** `last_sync.file_shas` is capped at 5000 entries (`MAX_FILE_SHAS` in `sync.py`) so `/data/github_sync.json` stays small for huge folders; truncated snapshots record `file_shas_truncated`/`file_shas_total`, and the public API exposes the flag (never the hashes).
- New unit tests: device-flow broker (start/poll/cancel/expiry), store mapping round-trip and validation helpers, and file-sha capping.

### Changed

- Device authorization is now the only sign-in method — no configuration options, no scope picker. `POST api/oauth/device/start` needs no setup; legacy `oauth` config in `/data` is dropped on load.

### Removed

- Personal access token entry (`POST api/token`), custom OAuth App settings (`POST api/oauth/config`), browser OAuth flow (`POST api/oauth/web/start`, `GET api/oauth/callback`), scope picker, and GitHub Enterprise API URL support.

### Fixed

- `store.py` crashed with `NameError` when saving a mapping or listing non-empty mappings (missing `_interval`, `_direction`, `_public_last_sync` helpers). All three are implemented and covered by tests.


- **In-app update check and one-click updates.** The app checks for a newer version of itself in the background (every 30 minutes) and on demand: the header shows the installed version, an "App updates" card in Settings reports the latest version and source, and a green banner with **Update now** appears when a new version exists. Updates are installed through Home Assistant's update entity (`update/install` service), so the Supervisor's redownload + restart happens immediately and the sidebar reconnects automatically. A Home Assistant persistent notification (once per version) is raised when an update is available. Update sources: Supervisor App store (`/addons/self/info`) with a fallback to the public GitHub release of this repository for local development.
- Runtime version module (`github_sync/app/version.py`) kept in sync with `config.yaml` and the Dockerfile label by the release script; `GET api/status` now reports `version`.
- New endpoints: `GET api/updates` (cached status), `POST api/updates/check` (force check), `POST api/updates/install` (start update via Home Assistant).
- Unit tests for version parsing/comparison, update sources, update-entity discovery, the update trigger, and the checker's cache/notification behaviour.

- Refreshed the Home Assistant App Store icon and repository banner with a consistent folder-and-sync visual identity; the icon is also shown in the Ingress header and browser tab.
- Added per-blob upload progress so large uploads report completed blobs while GitHub Data API requests run concurrently.
- Added an explicit **Delete local files that are not present in GitHub** checkbox to the Download confirmation dialog. It is off by default and still respects download-ignore rules.

### Changed


## [0.2.0] - 2026-09-22

### Fixed

- App linter: dropped obsolete `watchdog` and default-value keys from `config.yaml`. Health is a Docker `HEALTHCHECK` instead.

### Added

- Per-mapping **automatic sync**: 15 minutes, hourly, 6 hours, or daily, with upload, download, or check-only. The scheduler wakes every 30 seconds inside the app process.
- Home Assistant **persistent notifications** when a sync fails, and when check-only auto-sync finds differences (`homeassistant_api: true`).
- Live progress text during Check / Upload / Download (`GET api/progress`), shown on the busy overlay.
- **Conflict** detection on Check after a successful sync: files where both local and remote changed since the last snapshot.
- Mapping cards show auto-sync schedule and the last error, if any.
- Unit tests for gitignore matching, path sandbox, git blob SHA, and scheduler due dates (`tests/`).
- Roadmap **handoff** block so the next agent knows version, branch, what works, and what to build next.

## [0.1.0] - 2026-09-22

### Changed

- **Project type:** this is now a Home Assistant **App** (formerly add-on), not a HACS custom integration. Apps run in a Supervisor container with Ingress, so the UI, file browser, and GitHub sync are not loaded inside Home Assistant Core.

### Added

- App store repository (`repository.yaml`) and `github_sync/` Supervisor app (config, Dockerfile, Ingress on port 8099, admin sidebar).
- Mounts for Home Assistant config, share, media, backup, addons, and all add-on configs.
- Sidebar UI: connect a GitHub PAT, map folders to different repositories, file browser, smart gitignore editor, Check / Upload / Download.
- Gitignore presets (HA secrets, databases, logs, Python, Node, ESPHome) and live include/exclude preview.
- Async GitHub Git Data API client (blobs, trees, commits, refs), including the first commit on an empty repository.
- Persistent mappings and token in the app `/data` volume (token never returned to the browser).
- Hass watchdog on `/api/health`.
- App linter workflow and auto-release on merge to `main`.
