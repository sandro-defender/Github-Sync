/** Settings page: GitHub connection, access limits, app updates, how sync works. */
import { html } from "../deps.js";
import { askUpdate, checkUpdatesNow, logout, openAuthSetup, refresh } from "../actions.js";
import { absoluteTime, relTime } from "../format.js";
import { canSelfUpdate, status, updateAvailable, updates, version } from "../state.js";
import { Badge, Banner, Button, Card, Icon } from "../ui.js";

const SCOPE_LABELS = {
  public_read: "Public repositories, read-only",
  public_write: "Public repositories, read + write",
  repo: "All repositories you can access (private included)",
};

/**
 * Where on GitHub the repository access of the current connection is managed.
 *
 * Fine-grained tokens select repositories on GitHub itself; OAuth device
 * grants cannot be limited per repository, so the app-side allowlist (or a
 * fine-grained token) is the answer there.
 */
function githubRepoSettings(authMethod) {
  if (authMethod === "token") {
    return {
      href: "https://github.com/settings/personal-access-tokens",
      label: "Add or remove repositories on GitHub",
      hint: "On GitHub open your fine-grained token → Repository access → “Only select repositories” to add or remove repos, save, then Reload here.",
    };
  }
  return {
    href: "https://github.com/settings/applications",
    label: "Review authorization on GitHub",
    hint: "GitHub cannot limit an OAuth grant per repository. Use Manage access above for app-enforced repository limits, or connect a fine-grained token for GitHub-enforced repository selection.",
  };
}

/** GitHub account + authorization details. */
function GitHubCard() {
  const info = status.value || {};
  const access = info.access || {};
  const repositories = access.repositories || [];
  const repoSettings = info.configured ? githubRepoSettings(info.auth_method) : null;
  return html`<${Card}
    title="GitHub connection"
    icon="github"
    actions=${html`<${Button} variant="ghost" size="sm" icon="sliders" onClick=${() => openAuthSetup(true)}>Manage access</${Button}>`}
  >
    ${info.configured
      ? html`<dl class="review">
          <div><dt>Account</dt><dd>@${info.username || "connected"}</dd></div>
          <div>
            <dt>Method</dt>
            <dd>
              ${info.auth_method === "token" ? "Fine-grained token (GitHub-enforced limits)" : "Device authorization"}
              ${info.requested_scope && info.auth_method !== "token"
                ? html`<span class="meta"> · ${SCOPE_LABELS[info.requested_scope] || info.requested_scope}</span>`
                : null}
            </dd>
          </div>
          <div>
            <dt>Operation mode</dt>
            <dd>
              ${access.mode === "write"
                ? html`<${Badge} tone="warning" icon="zap">read + write</${Badge}>`
                : html`<${Badge} tone="success" icon="lock">read-only</${Badge}>`}
            </dd>
          </div>
          <div>
            <dt>Repositories</dt>
            <dd>
              ${repositories.length
                ? html`<span class="chips inline">${repositories.map((repo) => html`<${Badge} key=${repo} tone="neutral" icon="github">${repo}</${Badge}>`)}</span>`
                : html`<span class="meta">No allowlist set — app limits are unrestricted.</span>`}
            </dd>
          </div>
        </dl>`
      : html`<${Banner} tone="warning" icon="warning" title="Not connected">
          Authorize with a device code (recommended) or connect a fine-grained token with GitHub-enforced repository and Contents limits.
        </${Banner}>`}
    <div class="row">
      ${info.configured
        ? html`<${Button} variant="ghost" icon="logout" onClick=${logout}>Log out</${Button}>
            <a class="btn ghost sm" href=${repoSettings.href} target="_blank" rel="noopener noreferrer">
              <${Icon} name="github" size=${15} />
              <span class="btn-label">${repoSettings.label}</span>
              <${Icon} name="external" size=${14} />
            </a>
            <a class="btn ghost sm" href=${info.installation_url || (info.installation_id ? `https://github.com/settings/installations/${info.installation_id}` : "https://github.com/settings/installations")} target="_blank" rel="noopener noreferrer">
              <${Icon} name="github" size=${15} />
              <span class="btn-label">Manage repositories</span>
              <${Icon} name="external" size=${14} />
            </a>`
        : html`<${Button} icon="github" onClick=${() => openAuthSetup()}>Connect GitHub</${Button}>`}
    </div>
    ${repoSettings ? html`<p class="meta">${repoSettings.hint}</p>` : null}
    <p class="meta">
      App-side limits are enforced by this app; only a fine-grained token restricts what the GitHub grant itself can do.
      Logging out clears local credentials and does not revoke GitHub grants.
    </p>
  </${Card}>`;
}

/** App self-update card (exported for tests — pure function of the signals). */
export function UpdateCard() {
  const up = updates.value || {};
  const current = up.current_version || version.value || "unknown";
  const source =
    up.source === "supervisor" ? "Home Assistant App store" : up.source === "github" ? "GitHub releases" : "not checked yet";
  return html`<${Card} title="App updates" icon="sparkles">
    <dl class="review">
      <div><dt>Installed</dt><dd>v${current}</dd></div>
      <div><dt>Latest known</dt><dd>${up.latest_version ? `v${up.latest_version}` : "—"}</dd></div>
      <div><dt>Source</dt><dd>${source}${up.checked_at ? html`<span class="meta"> · checked ${relTime(up.checked_at)}</span>` : null}</dd></div>
    </dl>
    ${up.error ? html`<p class="meta note error"><${Icon} name="warning" size=${13} /> ${up.error}</p>` : null}
    ${up.warning ? html`<p class="meta note"><${Icon} name="info" size=${13} /> ${up.warning}</p>` : null}
    ${updateAvailable.value
      ? canSelfUpdate.value
        ? html`<div class="row">
              <${Button} variant="ok" icon="sparkles" onClick=${askUpdate}>Update to v${up.latest_version}</${Button}>
              <${Button} variant="ghost" icon="refresh" onClick=${checkUpdatesNow}>Check again</${Button}>
            </div>
            <p class="meta">Home Assistant installs the update and restarts the app automatically — this panel reconnects by itself.</p>`
        : html`<div class="row"><${Button} variant="ghost" icon="refresh" onClick=${checkUpdatesNow}>Check again</${Button}></div>
            <p class="meta">In-app updates need the Home Assistant Supervisor (App store). Update this app from its install source instead.</p>`
      : html`<div class="row"><${Button} variant="ghost" icon="refresh" onClick=${checkUpdatesNow}>Check for updates</${Button}></div>
          <p class="meta">
            ${up.error
              ? "Could not verify updates. Try again or look in the App store."
              : up.latest_version
                ? `You have the latest version (v${current}).`
                : "A background check runs every 30 minutes; the button performs an immediate check."}
          </p>`}
  </${Card}>`;
}

/** How the three sync directions behave. */
function HowItWorksCard() {
  return html`<${Card} title="How sync works" icon="info">
    <ul class="explain">
      <li>
        <${Icon} name="eye" size=${16} />
        <div><strong>Check</strong><span>Compares git blob hashes. After at least one successful sync it also flags conflicts (changed on both sides).</span></div>
      </li>
      <li>
        <${Icon} name="upload" size=${16} />
        <div><strong>Upload</strong><span>Replaces the mapped repository subtree with your local files and commits them. Remote-only files are deleted; use Preview to see the plan first.</span></div>
      </li>
      <li>
        <${Icon} name="download" size=${16} />
        <div><strong>Download</strong><span>Writes remote files locally. Extra local files stay unless you enable cleanup; both directions respect their own ignore rules.</span></div>
      </li>
      <li>
        <${Icon} name="clock" size=${16} />
        <div><strong>Auto-sync</strong><span>Runs per mapping on its own interval while the app is started. Check-only never writes — it notifies when files differ.</span></div>
      </li>
    </ul>
  </${Card}>`;
}

/** Connection + environment details (support-friendly, no secrets). */
function AboutCard() {
  const info = status.value || {};
  return html`<${Card} title="About this app" icon="terminal">
    <dl class="review">
      <div><dt>Version</dt><dd>v${info.version || version.value || "unknown"}</dd></div>
      <div><dt>API base</dt><dd class="mono">${info.api_base || "https://api.github.com"}</dd></div>
      <div><dt>Mounted roots</dt><dd class="mono">${(info.roots || []).join(", ") || "—"}</dd></div>
      <div><dt>Supervisor API</dt><dd>${info.supervisor ? "available" : "not available (no notifications/updates)"}</dd></div>
      <div><dt>Last page load</dt><dd class="meta">${absoluteTime(new Date().toISOString())}</dd></div>
    </dl>
  </${Card}>`;
}

/** Tokens/scope note shown under the connection card. */
function SecurityNote() {
  return html`<p class="meta center-note">
    The GitHub token stays in <span class="mono">/data/github_sync.json</span> inside this app container and is never returned by the API.
  </p>`;
}

export function SettingsView() {
  return html`<div class="stack">
    <${GitHubCard} />
    <${UpdateCard} />
    <div class="split">
      <${HowItWorksCard} />
      <div class="stack">
        <${AboutCard} />
        <${Card} title="Need a check?" icon="refresh" actions=${html`<${Button} variant="ghost" size="sm" icon="refresh" onClick=${refresh}>Reload</${Button}>`}>
          <p class="meta">Refresh reloads status, mappings and the update snapshot without leaving this page.</p>
        </${Card}>
      </div>
    </div>
    <${SecurityNote} />
  </div>`;
}
