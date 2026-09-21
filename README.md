# GitHub Sync

[![GitHub release](https://img.shields.io/github/v/release/sandro-defender/Github-Sync)](https://github.com/sandro-defender/Github-Sync/releases)

**Home Assistant App** (formerly add-on) that syncs **any folder** Home Assistant can see — `/config`, `/share`, `/media`, backups, add-on configs — with a GitHub repository.

Each folder can point at a **different repo and branch**. After install, **GitHub Sync** appears in the sidebar (admin users) with a file browser, a smart `.gitignore` editor, and **Check for updates / Upload / Download**.

This is not a HACS integration and not a git client on the host. The app runs in its own Supervisor container and talks to GitHub over the REST **Git Data API**.

Requires **Home Assistant OS** or **Supervised**. Container and Core installs do not have Apps.

## Features

- Connect one GitHub account (personal access token). Map many folders.
- File browser over Supervisor mounts (`homeassistant`, `share`, `media`, `backup`, `addons`, `addon_configs`).
- Search repositories the token can access, or type `owner/name`.
- Separate **upload ignore** and **download ignore** lists (gitignore syntax).
- Presets for Home Assistant secrets, databases, logs, Python, Node, and ESPHome.
- Live preview of included vs skipped files, with checkboxes to toggle them.
- Check for updates: compare git blob hashes. Nothing is written.
- Upload: commit the folder to the mapped branch (creates the first commit if empty).
- Download: write remote files onto disk. Extra local files are kept unless you opt into deletion.
- Admin-only sidebar via Ingress. The token never reaches the browser.
- Optional **automatic sync** per mapping (every 15 minutes, hourly, 6 hours, or daily): upload, download, or check-only.
- Home Assistant persistent notification when a sync fails (or when check-only finds differences).
- Check for updates can flag **conflicts** after you have synced at least once (local and remote both changed since last sync).

## Token permissions

**Fine-grained token (recommended)**

- Repository access: only the repos you will sync
- Permissions: **Contents → Read and write**, **Metadata → Read**

**Classic token**

- Scope: `repo` (or `public_repo` for public repositories only)

GitHub Enterprise: set the API URL in Settings (for example `https://github.example.com/api/v3`).

## Installation

1. In Home Assistant go to **Settings → Apps → App store**.
2. Three dots → **Repositories** → add  
   `https://github.com/sandro-defender/Github-Sync`
3. Find **GitHub Sync** under the new repository and **Install**.
4. Start the app. Open **GitHub Sync** in the sidebar (or **Open Web UI** on the app page).
5. Settings → paste the token → Save.

Local development copy: put this repository’s `github_sync/` folder into `/addons/github_sync` on the HA host, then **Check for updates** in the App store. It appears under **Local apps**.

## Using the sidebar

### Add a folder mapping

1. **+ Add folder sync**
2. **Folder** — browse mounts and select a directory (for example `homeassistant/esphome` or `share/backups`).
3. **Repository** — pick from the list or type `owner/repo`, set the branch, optionally a path *inside* the repo if the folder should not replace the entire tree.
4. **Ignore rules** — edit upload vs download gitignore. Use presets. Uncheck files in the preview to exclude them.
5. **Review** — optional commit message template with `{name}`, `{folder}`, `{repository}`, `{timestamp}`. Enable **automatic sync** here if you want the app to run on an interval.
6. **Save mapping**

### Buttons

| Button | What it does |
| --- | --- |
| **Check for updates** | Lists files that differ. No writes. |
| **Upload** | Commits local (non-ignored) files to GitHub. |
| **Download** | Overwrites local files with remote versions (download-ignore still applies). |
| **Edit** | Change folder, repo, branch, or ignore rules. |
| **Remove** | Deletes the mapping only — not GitHub, not local files. |

## Default ignore

New mappings exclude runtime and secrets from **upload**:

- `.storage/`, `.cloud/`, `.ssh/`
- `secrets.yaml`, `ip_bans.yaml`
- `*.log`, `*.db*`
- `__pycache__/`, `deps/`, `tts/`

**Download** ignore is stricter on secrets so a GitHub copy cannot clobber `secrets.yaml` or `.storage` unless you remove those patterns.

`.git` is always skipped.

## Safety notes

- Paths cannot leave Supervisor-mounted directories.
- Files larger than 50 MB are skipped.
- **Upload with an empty repo path replaces the repository tree** with the folder contents. Keep a README in the repo by putting it in the local folder or setting **repo path** (for example `homeassistant/`) so the rest of the repo is preserved.
- Download does not delete extra local files from the UI. That option exists on the API (`delete_extras`).
- The access token is stored in the app `/data` volume and is never returned by the API.

## App options

| Option | Description |
| --- | --- |
| Log level | `trace`, `debug`, `info`, `warning`, `error` |

GitHub credentials are configured in the app UI, not in the Supervisor options form.

Automatic sync runs inside the app process (every 30 seconds it checks which mappings are due). The Home Assistant instance must keep the app **started**. Check-only auto-sync never writes; it notifies if files differ.

## Development

```
PYTHONPATH=github_sync/app python3 -m unittest discover -s tests -v
```

See `ROADMAP.md` (handoff section) and `AGENTS.md` before changing code.

## Releases

Merges to `main` publish a GitHub Release (`.github/workflows/release.yml`). Supervisor uses `github_sync/config.yaml` `version` for updates.

Every change in this repository must update:

1. This README if behaviour, install, or UI changed
2. `CHANGELOG.md`
3. `ROADMAP.md` if a phase or task moved

See `AGENTS.md` and `ROADMAP.md`.

## License

MIT — see [LICENSE](LICENSE).
