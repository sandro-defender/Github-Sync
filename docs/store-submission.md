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
| **Pre-built multi-arch images** | ✅ `image:` is pinned in `config.yaml`; `0.4.0` and **`0.5.1`** + `latest` are published and anonymously pullable (`0.5.0` was skipped — its publish was denied by GHCR, see [One-time registry setup](#one-time-registry-setup-per-package-in-the-browser)) |
| A release can never advertise an uninstallable version | ✅ `release.yml` publishes and verifies the image *before* committing the version bump; `publish.yml` ends with a registry `verify` job; `validate.yml` audits weekly |
| Verified on a real Home Assistant OS install | ⏳ see “Device verification” below |
| AppArmor profile (optional, extra security point) | ⏳ not shipped — needs on-device validation first |

## Turning on pre-built images

Supervisor builds the app locally on the user's machine while `config.yaml` has
no `image:` key. That is slow and can fail on constrained hardware, so the
preferred end state is a published multi-arch image — which is what the
repository ships now:

```yaml
# github_sync/config.yaml
image: "ghcr.io/sandro-defender/github_sync"
```

Supervisor appends `:<version>` to that value and pulls the result. **There is
no fallback to a local build**: if the manifest for the advertised version does
not exist, every install and update fails with

```
Can't install ghcr.io/sandro-defender/github_sync:0.5.0: [404] manifest unknown
```

so the pipeline is built to never advertise a version it cannot serve.

### One-time registry setup (per package, in the browser)

There is no API for either of these, and they must be repeated for each of the
three packages — `github_sync`, `aarch64-github_sync`, `amd64-github_sync`:

1. **Make the package public.** GitHub creates container packages as *private*
   regardless of the repository visibility, and Supervisor pulls anonymously, so
   a private package fails with `unauthorized`.
   `https://github.com/users/sandro-defender/packages/container/package/<name>`
   → *Package settings → Danger Zone → Change visibility → Public*.
   This cannot be undone. *(Done — all three are public.)*
2. **Re-grant Actions access immediately afterwards.** Changing how a package
   gets its permissions *overwrites the existing ones* — the package stops
   inheriting the linked repository's permissions, and with them the write
   access that let `GITHUB_TOKEN` push. The very next publish then dies with
   `denied: permission_denied: write_package`, which is exactly what happened to
   `0.5.0` (it was never published; `0.5.1` shipped once access was restored).
   In the same sitting:
   *Package settings → Manage Actions access → Add repository →
   `sandro-defender/Github-Sync` → Role: **Write***. *(Done — and proven: the
   `0.5.1` publish run pushed both architectures and the manifest.)*

Both steps are listed in the order they must be done because step 1 silently
undoes what the first publish relied on.

### What the pipeline does per release

`release.yml` runs on every merge to `main` and, in this order:

1. computes the next version (`.github/scripts/prepare_release.py`) and writes it
   into `config.yaml`, the `io.hass.version` Dockerfile label and
   `app/version.py` — **without committing yet**;
2. dispatches **Publish app image** with that version
   (`gh workflow run publish.yml --ref main -f version=<version>`) and waits for
   it. `publish.yml` builds `ghcr.io/sandro-defender/{arch}-github_sync`,
   publishes the multi-arch manifest `ghcr.io/sandro-defender/github_sync`
   (`<version>` + `latest`), aligns the version inside the image with the tag it
   is published under, and finishes with a `verify` job that pulls the registry
   anonymously the way Supervisor does;
3. only when that run is green **and** all four references exist: commits the
   version bump, tags and creates the GitHub Release.

If publishing fails, step 3 never happens: `main` keeps advertising the previous
— installable — version, the Release job turns red, and its annotations say what
to fix. No user ever sees an update that cannot be installed.

Registry credentials are `secrets.GHCR_TOKEN` when that repository secret exists
(a classic PAT with `write:packages`, optionally with the `GHCR_USERNAME`
repository variable), otherwise the workflow's `GITHUB_TOKEN`. The PAT is the
escape hatch for when package permissions get out of sync again.

### Checking a version by hand

```bash
.github/scripts/check_published_images.sh          # version from config.yaml
.github/scripts/check_published_images.sh 0.5.1    # explicit
```

Every line must be a green ✓. The script distinguishes *not published* (404)
from *private* (401/403) from *registry unreachable* (exit 2) and prints the
matching remediation; in CI it also emits `::error::` annotations. `validate.yml`
runs it as a weekly audit of whatever `main` currently advertises.

To (re)publish without a release — for example after fixing package permissions:

```bash
gh run rerun <failed-publish-run-id>                    # same commit, same version
gh workflow run publish.yml --ref main                  # config.yaml version
gh workflow run publish.yml --ref main -f version=0.5.0 # explicit version
```

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
