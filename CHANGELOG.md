# Changelog

## [Unreleased]

### Modern sidebar UI (current session)

- **Rewrote the Ingress panel as a component-based app** (Preact 10.27 + `@preact/signals` + `htm`) with no build step: the runtime is vendored as ESM under `github_sync/app/static/lib/` and wired up in `static/app/deps.js`, so the panel works entirely offline and there is no CDN, bundler or npm dependency. Source is split into `state.js` (signals store), `actions.js` (API flows), `api.js`, `format.js`, `ui.js` (design-system primitives) and `views/` (shell, header, mappings, wizard, diff, settings, dialogs).
- **New visual language** (`static/styles.css`, rewritten as a design system): dark-first slate/graphite palette with gradient accents and glass surfaces, an automatic light theme, sticky blurred header, pill navigation, status dots per mapping, skeleton loaders, toasts, shimmering progress bar, and reduced-motion support.
- **UX improvements**: instant mapping search, filter chips on check results, one-click GitHub links per mapping, a four-step wizard with a real stepper, live ignore preview with toggleable files, confirmations that keep the dry-run preview one click away, keyed dialogs (Esc/backdrop close, focus on open), account dropdown with connection details, copy-to-clipboard device code, and an error banner instead of silent failures.
- **Accessibility & robustness**: `aria-live` toasts and busy overlay, `role=tablist`/`aria-selected` navigation, focus-visible rings, error boundary so a render crash shows a recovery panel, and a full-screen overlay while an app update restarts the container.
- Signals re-render only what changed, so typing in the ignore editor no longer rebuilds the page and long jobs update progress without redrawing the panel.

### Store readiness and release pipeline (current session)

- **Publish workflow for pre-built multi-arch images** (`.github/workflows/publish.yml`): builds `ghcr.io/sandro-defender/{arch}-github_sync` with the Home Assistant builder actions on merges to `main`, releases and manual runs, then publishes the arch-independent manifest `ghcr.io/sandro-defender/github_sync` (`<version>` + `latest`). Users then download an image instead of building the app locally.
- **Pull-request builds**: the publish workflow also runs for pull requests in build-only mode (`push: false`, manifest job skipped), so the Dockerfile and builder inputs are proven before merge. Both `amd64` and `aarch64` images build in ~1m35s each.
- **Release-ordered publishing**: `release.yml` dispatches the image build *after* committing the version bump (pushes made with `GITHUB_TOKEN` cannot trigger workflows), so the Registry tag always matches the version users get in `config.yaml` instead of the previous release.
- **Image verification helper** (`.github/scripts/check_published_images.sh`): checks the manifest and both arch images in GHCR and prints the exact `image:` line to add to `config.yaml`. `image:` stays unset until every check passes, because a missing manifest makes the Supervisor fail the install instead of falling back to a local build.
- **Store artwork normalised** with the new `.github/scripts/optimize_store_assets.py`: `icon.png` 1536×1536 → 128×128 and `logo.png` 2880×1440 → 250×100 (2.29 MB → 39 KB combined), matching the presentation guidelines.
- **Supervisor option translations** added for German, French, Spanish and Italian alongside English (`github_sync/translations/`).
- **App folder README** (`github_sync/README.md`) for the App store intro and **store submission documentation** (`docs/store-submission.md`) covering the requirement checklist, the image rollout steps, a real-device verification list, and how a curated repository submission works.

### Frontend test suite (current session)

- Replaced the string-scraping frontend tests with **render tests**: `node --test tests/test_frontend.cjs` mounts the real Preact app into `tests/dom_stub.cjs` (a minimal DOM with elements, attributes, events and `innerHTML` serialisation) against a faked `fetch`, covering the mapping list, header/update banner, access dialog payloads, token secrecy, dry-run requests, confirmation options, wizard navigation, error surfacing, escaping, logout and a smoke pass over every view/overlay.
- CI now parses every shipped frontend module as ESM (`node --input-type=module --check`, so `node --check` no longer fails on `import`/`export`) and runs the render suite; `AGENTS.md` and the README document the frontend layout and test commands.


### Dry-run previews and safety (current session)

- Complete the roadmap dry-run item: Upload/Download confirmation offers **Preview (dry run)**. Direction-specific plans list creates, overwrites and deletions, including upload subtree replacement and optional download cleanup. Execution always requires a separate confirmation.
- `POST api/upload` / `api/download` accept strict boolean `dry_run`; preview performs no GitHub mutations, local writes/deletes, metadata saves or HA notifications, including error paths. Read-only connections can preview uploads without gaining write access.
- Reject incomplete folder scans/GitHub trees and unsafe local symlinks or remote traversal paths. Keep preview and execution path checks consistent.
- Add nine Python dry-run regressions (filesystem/data snapshots, remote mutation guards, preview/execution parity, empty repos, ignore/cleanup and failure paths) and five dependency-free frontend request/render tests in CI. Raise the busy overlay above dialogs to prevent duplicate submissions.

### GitHub access controls (current session)

- Choose read-only vs read/write operations and an explicit repository allowlist before authorizing. Select device OAuth scope (`public_read`, `public_write`, `repo`); the flow keeps its policy server-side so polling cannot widen it.
- Add an optional fine-grained token connection for **GitHub-enforced** selected-repository/Contents permissions. Clearly explain that device OAuth scopes are broader and app limits do not restrict the grant itself.
- Enforce policies server-side for manual and scheduled sync, repository/branch browsing, mapping creation and Git Data writes; reject unsafe API paths and cross-host credential forwarding. Empty allowlists deny all repositories; legacy connections keep existing access until configured.
- Persist non-secret policy metadata, allow changing limits in Settings, reset policy on logout and clear account-specific UI caches. Tokens are never echoed by the API or kept in frontend state.
- Add authorization/API regression coverage and a Python test CI job alongside App metadata linting.

### Fixed (current session)

- Correct the Supervisor self-info URL (remove `/api`), unwrap the real `result`/`data` response, and accept repository-prefixed app slugs. No elevated Supervisor API permission is needed.
- Clear stale update errors after recovery, distinguish successful GitHub fallbacks from failures, suppress install controls for unconfirmed releases, and immediately surface rejected install requests.
- Test real Supervisor envelopes, malformed payloads, fallback and recovery. Release-version assertions no longer depend on an outdated installed version.

### Added

- **Device-code popup.** **Authorise with device code** (Settings, header, empty Mappings page) opens a popup with the short code — auto-copied to the clipboard, click to copy again — plus an **Open GitHub** approval link, live approval polling, and expiry countdown. It closes by itself once approved.
- **Clickable `@username` header menu.** While signed in, the username chip opens a GitHub menu: **GitHub options**, **Switch account**, and **Log out**. A **Connect** chip shows in the header when signed out.
- **Capped conflict snapshots (roadmap).** `last_sync.file_shas` is capped at 5000 entries (`MAX_FILE_SHAS` in `sync.py`) so `/data/github_sync.json` stays small for huge folders; truncated snapshots record `file_shas_truncated`/`file_shas_total`, and the public API exposes the flag (never the hashes).
- New unit tests: device-flow broker (start/poll/cancel/expiry), store mapping round-trip and validation helpers, and file-sha capping.

### Changed

- Previous release: device authorization became the only sign-in method — superseded by the access controls above. `POST api/oauth/device/start` needs no setup; legacy `oauth` config in `/data` is dropped on load.

### Removed

- Previous release: personal access token entry (`POST api/token`, now restored for fine-grained tokens only), custom OAuth App settings (`POST api/oauth/config`), browser OAuth flow (`POST api/oauth/web/start`, `GET api/oauth/callback`), scope picker, and GitHub Enterprise API URL support.

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

## [0.3.2] - 2026-09-22

- Complete roadmap dry-run previews without file or metadata writes
- Add selected repository and write permissions to GitHub authorization
- Fix Supervisor update checks and recover cleanly from fallback failures

## [0.3.1] - 2026-09-22

- Merge branch 'main' into arena/01a0c6c9-github-sync
- Simplify GitHub sign-in to device-code only with popup and header menu

## [0.3.0] - 2026-09-22

- Merge branch 'main' into arena/01a0c675-github-sync
- feat: zero-config GitHub login via built-in device-flow client
- feat: in-app update check with one-click updates

## [0.2.2] - 2026-09-22

- Add in-app update check with one-click updates (#3)

## [0.2.1] - 2026-09-22

- Add GitHub OAuth authorization choices

All notable changes to GitHub Sync are documented here.

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
