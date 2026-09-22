# Store readiness & submission

Where GitHub Sync is distributed today, what the upstream guidelines require,
and the exact steps left before it can be listed in a curated app store.

## Distribution tiers

| Tier | What users do | Status |
| --- | --- | --- |
| **1. Custom repository** | App store → ⋮ → Repositories → add `https://github.com/sandro-defender/Github-Sync` | ✅ Live — `repository.yaml` + `github_sync/` are enough |
| **2. Curated community repository** | Add `https://github.com/hassio-addons/repository` (already present on most installs) and install from there | ⏳ Blocked on the pre-built image publish (see below) |
| **3. Official Home Assistant app store** | Ships with Home Assistant | ❌ Not available for third-party apps |

## Checklist against the upstream guidelines

Guidelines: [App presentation](https://developers.home-assistant.io/docs/apps/presentation),
[Publishing](https://developers.home-assistant.io/docs/apps/publishing),
[Create an app repository](https://developers.home-assistant.io/docs/apps/repository).

| Requirement | Status |
| --- | --- |
| `repository.yaml` at the repository root | ✅ |
| App folder with `config.yaml`, `Dockerfile`, `run.sh` | ✅ `github_sync/` |
| Intro (`README.md`) | ✅ repository + `github_sync/README.md` |
| Documentation (`DOCS.md`) | ✅ `github_sync/DOCS.md` |
| `icon.png`, square, ~128×128 | ✅ 128×128 (normalise new art with `.github/scripts/optimize_store_assets.py`) |
| `logo.png`, ~250×100 | ✅ 250×100 |
| `CHANGELOG.md` | ✅ repository root, maintained by the release workflow |
| Licence | ✅ MIT |
| Supervisor option translations | ✅ en, de, es, fr, it |
| Health endpoint for the watchdog | ✅ `GET /api/health` |
| Ingress UI (no exposed port, no host network) | ✅ `ingress: true`, `ingress_stream: true` |
| Least privilege (no `host_*`, no `devices`, no `privileged`) | ✅ |
| CI (linter + Python + frontend tests) | ✅ `.github/workflows/validate.yml` |
| **Pre-built multi-arch images** | ⏳ pipeline builds `amd64` + `aarch64` successfully in pull-request runs; the first registry push happens on merge to `main` |
| Verified on a real Home Assistant OS install | ⏳ see “Device verification” below |
| AppArmor profile (optional, extra security point) | ⏳ not shipped — needs on-device validation first |

## Turning on pre-built images

Supervisor builds the app locally on the user's machine while `config.yaml` has
no `image:` key. That is slow and can fail on constrained hardware, so the
preferred end state is a published multi-arch image.

1. Merge the change. `release.yml` bumps the version, creates the release and
   then dispatches **Publish app image** — the dispatch happens after the bump
   so the image tag always equals the released version. Check the run
   (`gh run list --workflow=publish.yml`); it publishes:
   - `ghcr.io/sandro-defender/{arch}-github_sync:<version>` per architecture
   - `ghcr.io/sandro-defender/github_sync:<version>` + `:latest` (multi-arch manifest)
   If the dispatch was missed (for example when re-publishing by hand), start it
   yourself: `gh workflow run publish.yml --ref main`.
2. Verify from a machine with registry access:

   ```bash
   .github/scripts/check_published_images.sh 0.4.0
   ```

   Every line must be a green ✓ — the script exits non-zero if a manifest is
   missing.
3. Only then add the image to the app manifest and ship a patch release:

   ```yaml
   # github_sync/config.yaml
   image: "ghcr.io/sandro-defender/github_sync"
   ```

   The manifest tag must equal `version:` in `config.yaml`; the publish workflow
   tags every build with the version it reads from that file.

If a publish run fails, keep `image:` out: an installed version whose image does
not exist fails with “manifest unknown” instead of falling back to a local build.

## Device verification (before tier 2)

Run through this on a real Home Assistant OS or Supervised install:

- [ ] Add the custom repository and install the app; the sidebar panel opens.
- [ ] Device-code login: code is copied, approval closes the popup, `@username` appears.
- [ ] Fine-grained token login with **selected repositories** + Contents read-only: upload is refused, check/download still work.
- [ ] Read-only mode: Upload is denied by the app (not only hidden in the UI).
- [ ] Create a mapping (folder browser → repository → ignore rules → review) and run Check.
- [ ] Upload, then Download, then **Preview (dry run)** — counts match reality and nothing is written.
- [ ] Auto-sync (15 min / hourly) fires and a forced failure raises the HA notification.
- [ ] Settings → App updates finds a release and **Update now** restarts cleanly.
- [ ] Narrow ingress panel (mobile) and light/dark Home Assistant themes look correct.

## Submitting to the community repository

The curated repository is [`hassio-addons/repository`](https://github.com/hassio-addons/repository).
It is a *generated* aggregator: each app lives in its own `hassio-addons/app-*`
repository, is wired into [`.apps.yml`](https://github.com/hassio-addons/repository/blob/master/.apps.yml)
(`channel`, `repository`, `target`, `image`) and must build through their
tooling with a stable, published image.

Practical path:

1. Finish the device verification above and the pre-built image rollout here.
2. Open an issue in `hassio-addons/repository` describing the app, its licence,
   maintenance commitment and the image repository.
3. If accepted, mirror the app folder into the `hassio-addons/app-<slug>` layout
   they expect (that repository owns the release pipeline) and add an entry to
   `.apps.yml`.
4. Keep the version tags in `ghcr.io/sandro-defender/*` and the mirrored
   repository in sync; their Renovate configuration proposes bumps.

Until then, tier 1 already gives every feature: automatic updates, changelog on
release, HA notifications and one-click updates from inside the panel.
