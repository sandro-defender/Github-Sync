# GitHub Sync

Home Assistant App that syncs folders with GitHub. Open **GitHub Sync** in the sidebar after the app is started.

Press **Authorise with device code**, choose read-only/read-write operations and selected `owner/repo` repositories, then approve the short code on github.com — the popup copies it to your clipboard and signs you in automatically. While signed in, the `@username` chip in the header opens the GitHub menu (options, switch account, log out). The app checks for a newer version of itself in the background and offers a one-click **Update now** (installed through Home Assistant's update entity). See the repository [README](https://github.com/sandro-defender/Github-Sync) for mapping instructions, ignore rules, and safety notes.

OAuth scopes cannot limit the token to individual repositories: the app enforces your selection. For GitHub-enforced restrictions, choose the fine-grained token option and select repositories plus Contents read/read-write permissions on GitHub. Change app limits in **Settings → Repository & write access**. Logging out does not revoke the grant on GitHub.
