"""Runtime identity of the GitHub Sync app.

`__version__` must stay identical to `github_sync/config.yaml` `version` and
the `io.hass.version` Dockerfile label. The release workflow
(`.github/scripts/prepare_release.py`) bumps all three together on merge to
`main`, so do not edit them by hand.
"""

__version__ = "0.5.0"

# Supervisor app slug (github_sync/config.yaml) used for self-updates.
APP_SLUG = "github_sync"

# Display name (github_sync/config.yaml `name`). Home Assistant names the
# auto-generated update entity after it, so the update trigger matches on it.
APP_NAME = "GitHub Sync"

# This application's own repository, used as the fallback update source when
# the Supervisor API is not available (e.g. local development).
APP_REPO = "sandro-defender/Github-Sync"
