# Changelog

## [0.9.0] - 2026-09-23

- feat(editor,ui): widescreen brother windows for upload/download and github app install options
- fix(explorer,access): fix folder/file deselect and allow unrestricted repo access

## [0.8.1] - 2026-09-23

- fix(updates,settings,explorer): direct GitHub update checks, repo manage link, operation mode save, and explorer deselect

## [0.8.0] - 2026-09-23

- fix(ui): set the tri-state tick inside the diff, not from a useEffect
- feat(ui): file explorer tree for ignore rules — tick any file or folder at any depth

## [0.7.0] - 2026-09-23

- feat(ui): folder rows in sync preview, readable unchecked rows, gated Uncheck all

## [0.6.0] - 2026-09-23

- feat(ui): working file-selection checkboxes, Uncheck all, GitHub repo settings link

## [0.5.2] - 2026-09-22

- docs(release): record that 0.5.1 shipped and the new pipeline is proven

## [0.5.1] - 2026-09-22

- fix(release): publish and verify the app image before advertising a version

## [Unreleased]

### Widescreen brother windows and GitHub App installation options

- **Widescreen brother windows for mapping rules & file explorer.** Step 3 of the mapping editor ("Ignore rules") now displays two side-by-side ("brother") windows/panels on widescreen displays (min-width 960px or toggled via the toolbar): one panel for Upload rules & file explorer (Local → GitHub) and one panel for Download rules & file explorer (GitHub → Local). Each window provides independent preset chips, gitignore pattern editing, re-scanning, and interactive folder tree ticking. A toolbar toggle allows users to switch between side-by-side and single tabbed view at any time on any screen size.
- **GitHub App installation navigation.** Added GitHub App installation options and direct links (`https://github.com/settings/installations`) in the connection setup dialog (`AuthSetupDialog`) and Settings view (`GitHubCard`), giving users easy access to install or manage GitHub App repositories directly on GitHub alongside OAuth device authorization and fine-grained tokens.

### File explorer deselect fixes and repository allowlist accessibility

- **Folder and file deselect in file explorer.** Fixed an issue where deselecting a file or subfolder inside a re-included folder (e.g. under `!/folder/**` or `!**`) failed because `applyPathToggle` and `applyFolderToggle` did not add explicit exclusion rules when an ancestor re-include was present in the explorer block. Unticking a file or subfolder covered by an ancestor re-include now appends an explicit exclusion rule (`path` or `/${folder}/`) to outvote the re-include rule. Also fixed unticking a folder without catch-all rules so that it writes an explicit folder exclusion (`/${folder}/`) rather than dropping re-includes and returning to an included/partial state.
- **Repository allowlist unrestricted default & discovery.** Fixed an issue where leaving the repository allowlist empty (as prompted by "Leave empty to allow every repository the account can see") was treated as allowing zero repositories, which hid all repositories from the repo picker (`api/repos`) and rejected sync with `AccessDenied`. An empty allowlist now correctly allows all repositories accessible to the authenticated account. Added an in-wizard notice and manage link on Step 2 ("Which repository?") when repository allowlist filtering is active, and clarified in Settings that OAuth device authorization is registered on GitHub as **"GitHub CLI"** under Settings → Applications → Authorized OAuth Apps.

### Direct GitHub update checking, repo management button, and explorer fixes

- **Direct GitHub release check on update requests.** Previously, update checks prioritized Supervisor and did not query GitHub when running with a Supervisor token. Because Home Assistant Supervisor caches repository metadata and polls on a multi-hour schedule, clicking "Check for update" reported that the app was already on the latest version even after a new release was published on GitHub. The update checker now queries GitHub releases directly on check, compares against Supervisor, surfaces newer GitHub releases immediately, and triggers Supervisor store reloads (`POST /store/reload`) on forced checks so Supervisor immediately discovers the new release.
- **Manage repositories button in GitHub settings.** Added a dedicated "Manage repositories" button under Settings → GitHub connection linking to GitHub App installations (`https://github.com/settings/installations` or `https://github.com/settings/installations/{id}`). The backend also queries `GET /user/installations` upon connecting to discover and store installation identifiers automatically.
- **Save operation mode (read-only / read-write) in GitHub access settings.** Fixed the "Manage access" dialog where buttons were disabled in editing mode and no save button was visible. Users can now easily switch between Read-only and Read & write operation modes and click "Save changes", which persists the access policy and cleanly closes the modal.
- **File explorer folder toggle and deselect fix.** Fixed an issue where unticking a folder or file under the catch-all `*` rule failed to deselect because `applyFolderToggle` and `applyPathToggle` incorrectly returned the original block containing re-include lines (`!/path`) instead of the filtered lines. Unticking now reliably removes the negation rules and deselects the folder or file. Clicking anywhere across a folder row now toggles the folder, and directory scanning descends into folders whenever any descendant path is requested in `wanted`.

### File explorer: a real folder tree instead of a flat preview

The mapping wizard's file selection was a flat list of the *first* included files, with everything else folded into "… and N more" rows you could not tick. Two things broke because of that: files past the cap could not be unchecked, and "Uncheck all" was disabled (it required every file to be checked, which a truncated list could never prove), so the bulk uncheck button looked dead. The preview is now a file explorer that walks the folder as deep as you open it.

- **Tree view with a checkbox on every row.** One row per file and per folder at any depth: click a name (or its caret) to open a folder, tick a file to include or ignore it, tick a folder to do it to the whole subtree. A folder whose contents are mixed is tri-state (indeterminate tick, half-filled style) and one click completes or clears everything inside — files the scan has not listed yet included, because a folder tick writes `/dir/` / `!/dir/` + `!/dir/**`, never a per-file list. Row counts are recursive rollups from the server (`3 of 5 files`, `2 folders`, size of what would be uploaded), so a closed folder still tells you what is in it.
- **No dead ends.** Levels page at 200 entries with a **Show more** row that *appends* (so nothing you can see can be out of reach), **Expand all** opens the tree in one request (`depth` walk), and the filter box searches the whole folder — including inside ignored ones, whose files stay individually togglable — instead of hiding rows that do not match. The only remaining bound is a server-side cap of 5 000 rows per folder level; such a level says "not every entry of this folder is listed — the filter below finds the rest" rather than offering a "Show more" that would never finish, and its counts stay exact because the walk does not stop. `.git` is never listed. A row is only dimmed, never struck through, and no path is unclickable because it was cut off.
- **The buttons always work.** `Uncheck all` (`*`) and `Check all` (`!**`) are enabled from any state and mirror each other, so pressing them repeatedly is harmless; a folder row tick and its untick are exact mirrors too, which means `*` + a ticked folder + untick returns your text byte-for-byte. Both stay disabled only when the scan has *proved* there is nothing to do, and never when it was cut short.
- **Your rules stay yours.** Everything the explorer writes goes into one marked block at the end of the textarea (`# GitHub Sync selection — the file explorer edits the lines below`); lines above it are never reordered, deleted or moved, and **Reset selection** deletes only the block. Re-including a file a preset still ignores is done by *adding* the `!` chain after it (gitignore's last match wins) rather than editing your line — that is also what makes ticking a file inside an ignored folder work, which it previously did not when the folder rule lived in the user's own text.
- **API.** New `POST api/preview_tree` (`github_sync/app/paths.py::collect_tree`): one request answers the mapping root plus every expanded level, each with its own `offset`/`size` window, folder rollups, the rule that ignored a row, `unknown` for pruned (unwalked) subtrees, and `can_open: false` for symlinked folders. It replaces the flat, capped `api/preview_ignore`, which stays for compatibility. `depth` auto-expands; `query` switches to a flat cross-folder search. Both share the existing path sandbox.
- **Tests.** 105 Python + 19 frontend pass (was 83 + 15). New `TreeScanTests` cover rollup accuracy, `.git` hiding, pruned-folder `unknown` state, catch-all folders staying counted, paging, a capped level keeping its exact rollup, `depth`, search (including inside ignored folders), symlinked folders, `walk_limit` truncation and unsafe level paths; new `tests/test_preview_tree_api.py` pins the endpoint contract, clamping and 400s; the frontend suite now drives the tree — tick/untick round trips, folder ticks over 4 000-file folders, "Show more" appending, the tri-state tick, Uncheck/Check all from any state, search rows, and the wizard saving the resulting block. A stray debounced scan can no longer leak between drafts (`setEditor` cancels it), which had made the suite order-dependent. The tree's third-state tick is now set as a property inside the render diff instead of from a `useEffect`: preact/compat defers `useEffect` by 35 ms, so the indeterminate dash landed a beat after the row — a visible flicker after each scan in the browser, and in CI a race against an assertion. Reading it straight after `paint()` now works, and a test that slept 25 ms to chase a 35 ms timer is gone (the debounce test polls instead of sleeping).

### Sync preview: folder rows, readable unchecked rows, gated “Uncheck all”

- **Folder rows in the “What will be synced” preview.** Files inside subfolders no longer each get their own row: everything under a top-level folder collapses into a single folder row with a tri-state checkbox (checked = all files included, unchecked = none, indeterminate = a mix — one tick completes the folder). Ticking a folder re-includes every excluded file in it; unticking one excludes every included file in it. Both reuse the exact per-file rule semantics (exact rules and `!` negation chains), so folder and file rows can never disagree. Excluded folders the walk pruned (e.g. `.storage/` from a preset) remain selectable as unchecked rows; always-ignored folders (`.git`) are hidden because ticking them can never work.
- **Unchecked rows are no longer struck through.** Ignored files and folders keep fully readable text and are only dimmed slightly, so excluded paths stay identifiable without a line through them.
- **“Uncheck all” is gated.** The button (per upload/download side) is only enabled while every file is checked. It still appends one `*` rule and never duplicates it; if the catch-all already exists and you ticked files back in, pressing it again drops the temporary `!` re-include lines so the result is still “everything unchecked”.
- **API.** `api/preview_ignore` now also returns `excluded_file_count` (excluded files only, folders excluded), keeping the “… and N more ignored files” hint accurate once folder rows group the list. Excluded directory entries that are always-ignored carry an `always_ignored: true` flag.
- **Tests.** The frontend suite now covers folder-row grouping and partial states, `.git` hiding, pruned-folder rows, the Uncheck all disabled/enabled lifecycle (including no duplicate `*`), folder-tick negation chains, and a CSS regression check that unchecked rows never get a strikethrough. 83 Python + 15 frontend tests pass.

### File selection in the sync preview + GitHub repository settings link (current session)

- **Fixed: the "What will be synced" checkboxes never changed anything.** The mapping wizard's ignore preview showed checked/unchecked rows, but the change handler inverted the checkbox state (`!ev.target.checked`), so unticking a file asked to *include* it (a no-op) and ticking an ignored file asked to *exclude* it (also a no-op). The selection was frozen. Unticking a file now excludes it (exact ignore rule), and ticking an ignored file includes it again (the rule is removed).
- **Ticking a file ignored by a broader rule now actually re-includes it.** Files excluded by a preset glob (e.g. `*.log`) or by the catch-all rule are re-included with an automatic anchored negation chain (`!/sub/`, `!/sub/file.yaml`) — required because gitignore cannot re-include a file while a parent folder stays ignored. Unticking that file again removes only its own `!` line.
- **New "Uncheck all" button on the sync preview** (mapping wizard, "Ignore rules" step, per upload/download side). It appends one `*` rule so everything is excluded; you then tick exactly the files you want to upload or download. Existing rules are untouched — deleting the `*` line restores them.
- **Files inside catch-all-ignored folders stay visible.** Folder pruning in the file walk skipped every folder matched by the user's ignore rules; with a catch-all `*` that hid the whole tree, leaving nothing to re-select. Folders whose last matching rule is `*`/`**` are now still walked (children remain individually ignored and selectable). Hand-written folder rules (`.storage/`, presets) keep the pruning fast-path and `.git` is always pruned, so sync results are unchanged.
- **The preview lists more of what the API returns** (500 included / 300 ignored rows instead of 300 / 120) with "… and N more" hint rows when the server-side caps are reached.
- **Settings → GitHub connection gained a button to the GitHub page where repository access is managed.** Fine-grained token connections link to the token list (*Repository access → Only select repositories* — add or remove repos there, then Reload); device/OAuth connections link to GitHub's authorized applications page with a hint that OAuth grants cannot be limited per repository (use the app's *Manage access* allowlist, or a fine-grained token for GitHub-enforced selection).
- **Tests.** New frontend regression tests drive real checkbox `change` events through the wizard (exclude → re-include → uncheck-all → chain-negate), assert no duplicate `*` rules, and check the per-auth-method settings link; new path-walk tests pin the catch-all expansion and the preserved folder pruning. Chain semantics were additionally verified against the live `api/preview_ignore` endpoint. 83 Python + 13 frontend tests pass.

### Publishing & release pipeline

- **Fixed the failure behind `Can't install ghcr.io/sandro-defender/github_sync:0.5.0: [404] manifest unknown`.** `0.5.0` was advertised in `config.yaml` while its image never reached GHCR: both publish build jobs were rejected with `denied: permission_denied: write_package`, so the multi-arch manifest job never ran. Making the three packages **public** after `0.4.0` moved them from "inherit access from the linked repository" to granular permissions, and GitHub overwrites existing permissions when that changes — silently revoking the `GITHUB_TOKEN` write access that had published `0.4.0`. Because `config.yaml` pins `image:`, Supervisor had no local-build fallback and every install/update of `0.5.0` failed.
- **A release can no longer advertise an uninstallable version.** `release.yml` now publishes *before* it advertises: it computes the next version, dispatches `publish.yml` with `-f version=<next>`, waits for that run, re-checks GHCR anonymously the way Supervisor does, and only then commits the version bump, tag and GitHub Release. If publishing fails, `main` keeps shipping the previous installable version and the Release job turns red with the remediation in its annotations.
- **`publish.yml` gained a `version` dispatch input and a `verify` job.** The input lets `release.yml` build the not-yet-committed version (and lets anyone republish a specific tag by hand); the `verify` job pulls all four references (`<version>` + `latest` manifest, both arch images) from a clean runner, so a green publish run now *proves* the version is installable.
- **The image reports the version it is tagged with.** A new `Align the packaged version` step runs `.github/scripts/app_version.py` inside the build job, so an image built from the pre-bump commit still carries the right `version:` and `__version__` — without it the app's own update check would offer the same update forever.
- **`GHCR_TOKEN` escape hatch.** `publish.yml` prefers the `GHCR_TOKEN` repository secret (a classic PAT with `write:packages`, optionally with the `GHCR_USERNAME` variable) over `GITHUB_TOKEN`, so publishing keeps working when package permissions get out of sync again.
- **Denied pushes explain themselves.** A failing build step now prints the exact *Package settings → Manage Actions access → Add repository → Write* recovery path plus the `gh run rerun` command, as both log output and `::error::` annotations.
- **`check_published_images.sh` distinguishes the three failure modes** — 404 (never published), 401/403 (package private) and registry unreachable (new exit code 2, previously reported as "missing") — and emits GitHub Actions annotations with the matching remediation. It also warns that making a package public revokes Actions write access, so the two browser steps are done together.
- **Weekly audit.** `validate.yml` gained a *Published image audit* job that verifies whatever `main` currently advertises is actually pullable: it fails loudly on the weekly schedule and on demand, and only warns on a plain push (the merge commit still carries the previous version while the release job publishes the new one).
- **Version handling de-duplicated** into `.github/scripts/app_version.py` (`read_config_version`, `current_versions`, `write_version`, plus a CLI that prints drift); `prepare_release.py` imports it and now reports all three version files, flagging any mismatch.
- **Verified end to end on merge.** The first release through the new pipeline published `0.5.1` before advertising it: Release run `35687629559` dispatched publish run `35687639503` (`-f version=0.5.1`), waited for both arch builds, the multi-arch manifest and the registry `verify` job, and only then committed `chore(release): v0.5.1`, tagged and released. `ghcr.io/sandro-defender/github_sync` now serves `0.5.1` + `latest`, so installs and updates work again. `0.5.0` was never published and is skipped — update straight to `0.5.1`.
- **Docs.** README gained a *When an update fails* table mapping Supervisor log lines to causes and fixes; `docs/store-submission.md` documents the one-time registry setup in the order it must be done, the per-release pipeline and how to republish by hand; `AGENTS.md` and `ROADMAP.md` record the GHCR visibility trap and the outstanding manual recovery for `0.5.0`.

## [0.5.0] - 2026-09-22

- docs(store): flag GHCR package visibility before enabling image:
- fix(publish): normalise JSON-quoted helper outputs before building tags
- feat(release): install from the published multi-arch image

### Release follow-up (shipped as 0.5.0, PR #8)

- **Installs now use the published image.** `github_sync/config.yaml` pins `image: "ghcr.io/sandro-defender/github_sync"`, the multi-arch manifest published for 0.4.0, so installing or updating downloads the app instead of building it on your Home Assistant machine.
- **Changelog structure tidied**: the detailed notes for the UI rewrite and store work moved into the `[0.4.0]` section (commit list plus explanations) instead of a floating block.
- Image tags followed the version in `config.yaml`, with the release workflow dispatching the publish *after* the bump. **Superseded** — that ordering is what let `0.5.0` be advertised while its image failed to publish; see `[Unreleased]` for the publish-before-advertise pipeline.
- **GHCR visibility is now documented and checked**: GitHub creates container packages as private, which would make Supervisor's anonymous pull fail with `unauthorized`; `check_published_images.sh` recognises 401/403, prints the exact “Change visibility → Public” links, and `docs/store-submission.md` lists it as the step before enabling `image:`.
- **Fixed the publish pipeline once `image:` exists**: the `info` helper returns JSON-quoted scalars, and quotes passed through `env:` are not interpreted by the shell, so buildx saw tags like `"ghcr.io/sandro-defender/amd64-github_sync":0.4.0` and failed with “invalid reference format”. The prepare step now normalises all helper outputs itself (the pull-request build mode caught this before it could reach users).

## [0.4.0] - 2026-09-22

Shipped in pull request #7 (merge commit `8d31027`). The publish workflow
uploaded `ghcr.io/sandro-defender/{arch}-github_sync` and the multi-arch
`ghcr.io/sandro-defender/github_sync` manifests tagged `0.4.0` and `latest`.

#### Commits

- fix(release): publish the app image after the version bump, not before
- docs(roadmap): record that the image pipeline builds both architectures in CI
- ci(publish): build the app image on pull requests too
- feat(ui): rebuild the sidebar panel with Preact + signals and ship store-readiness work

#### Details

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
