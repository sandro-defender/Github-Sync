# Changelog

All notable changes to GitHub Sync are documented here.

## [0.2.0] - 2026-09-22

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
