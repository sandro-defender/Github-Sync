# Changelog

## [0.2.1] - 2026-09-22

- Add GitHub OAuth authorization choices

All notable changes to GitHub Sync are documented here.

## [Unreleased]

### Added

- **In-app update check and one-click updates.** The app checks for a newer version of itself in the background (every 30 minutes) and on demand: the header shows the installed version, an "App updates" card in Settings reports the latest version and source, and a green banner with **Update now** appears when a new version exists. Updates are installed through Home Assistant's update entity (`update/install` service), so the Supervisor's redownload + restart happens immediately and the sidebar reconnects automatically. A Home Assistant persistent notification (once per version) is raised when an update is available. Update sources: Supervisor App store (`/addons/self/info`) with a fallback to the public GitHub release of this repository for local development.
- Runtime version module (`github_sync/app/version.py`) kept in sync with `config.yaml` and the Dockerfile label by the release script; `GET api/status` now reports `version`.
- New endpoints: `GET api/updates` (cached status), `POST api/updates/check` (force check), `POST api/updates/install` (start update via Home Assistant).
- Unit tests for version parsing/comparison, update sources, update-entity discovery, the update trigger, and the checker's cache/notification behaviour.

- Refreshed the Home Assistant App Store icon and repository banner with a consistent folder-and-sync visual identity; the icon is also shown in the Ingress header and browser tab.
- Added per-blob upload progress so large uploads report completed blobs while GitHub Data API requests run concurrently.
- Added an explicit **Delete local files that are not present in GitHub** checkbox to the Download confirmation dialog. It is off by default and still respects download-ignore rules.
- Added optional GitHub OAuth authorization with both browser redirect and device-code flows. Users can choose private/public repository scope; PAT entry remains available, and OAuth secrets stay server-side.

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
