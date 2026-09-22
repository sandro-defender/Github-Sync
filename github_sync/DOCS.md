# GitHub Sync

Home Assistant App that syncs folders with GitHub. Open **GitHub Sync** in the sidebar after the app is started.

Press **Connect** (or **Authorise with device code**), choose read-only/read-write operations and selected `owner/repo` repositories, then approve the short code on github.com — the dialog copies it to your clipboard and signs you in automatically. While signed in, the `@username` chip in the header opens the GitHub menu: **GitHub options** (scope, repositories, permissions) and **Log out** (log out and connect again to switch account). The app also checks for a newer version of itself in the background and offers a one-click **Update now**, installed through Home Assistant's update entity.

The panel itself is a modern single-page app served by this app over Ingress — it includes mapping search, status dots, filter chips on update checks, toasts and a mobile-friendly layout, and it follows your system light/dark preference. See the repository [README](https://github.com/sandro-defender/Github-Sync) for mapping instructions, ignore rules, and safety notes.

OAuth scopes cannot limit the token to individual repositories: the app enforces your selection. For GitHub-enforced restrictions, choose the fine-grained token option and select repositories plus Contents read/read-write permissions on GitHub. Change app limits in **Settings → GitHub connection → Manage access** (or the header menu → GitHub options). Logging out does not revoke the grant on GitHub.

Before syncing, use **Preview (dry run)** in Upload/Download confirmation. It shows planned creates, overwrites and deletions without changing files or history. Upload replaces the mapped remote subtree, including removal of remote files ignored locally; download cleanup is opt-in. Auto-sync continues independently.
