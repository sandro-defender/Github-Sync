# GitHub Sync

Sync any Home Assistant folder with a GitHub repository — each folder can target
a different repository and branch, with its own ignore rules and auto-sync
interval. The whole workflow lives in the Home Assistant sidebar.

- **Mappings** — folder → `owner/repo` (branch + optional repo subpath).
- **Check / Upload / Download** — Git-blob comparison, conflict flags, and a
  read-only **Preview (dry run)** before anything is written.
- **Smart gitignore editor** — presets for HA secrets, databases, logs, ESPHome,
  Python and Node, plus a **file explorer**: the mapped folder as a tree where every
  file *and* every folder can be ticked, and the matching rules are written for you.
- **Auto-sync** — per mapping: every 15 minutes, hourly, 6 hours or daily;
  upload, download or check-only. Failures raise a Home Assistant notification.
- **Optional protections** — read-only mode, `owner/repo` allowlists, or a
  fine-grained token so GitHub itself restricts repositories and permissions.
- **Self-update** — the panel notices new releases and installs them through
  Home Assistant's update entity.

Open **GitHub Sync** in the sidebar after starting the app.

Full documentation: [`DOCS.md`](DOCS.md) · Repository and installation
instructions: <https://github.com/sandro-defender/Github-Sync>

Requires Home Assistant OS or Supervised (apps are not available on Container
or Core). Licensed under the MIT licence.
