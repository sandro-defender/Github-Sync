/** Dialogs: confirmations, GitHub access setup, device code, busy + toasts. */
import { html } from "../deps.js";
import {
  cancelDeviceAuth,
  confirmOk,
  connectToken,
  copyDeviceCode,
  openAuthSetup,
  previewSync,
  saveAccess,
  startDeviceAuth,
} from "../actions.js";
import { authSetup, busy, confirm, devicePopup, dismissToast, error, toasts, updating, updates } from "../state.js";
import { Badge, Banner, Button, Field, Icon, Modal, Switch, ToastStack, BusyOverlay } from "../ui.js";

const SCOPES = [
  { value: "public_read", label: "Public repositories — read-only", hint: "Recommended for publishing a folder to a public repo." },
  { value: "public_write", label: "Public repositories — read & write", hint: "Public repos only; private repositories stay unreachable." },
  { value: "repo", label: "All repositories you can access — read & write", hint: "The broadest scope; includes private repositories." },
];

/** Confirmation for destructive or long-running operations. */
function ConfirmDialog() {
  const pending = confirm.value;
  if (!pending) return null;
  const isSync = ["upload", "download"].includes(pending.next?.type);
  return html`<${Modal}
    title=${pending.title}
    onClose=${() => (confirm.value = null)}
    size="sm"
    footer=${html`
      ${isSync ? html`<${Button} variant="ghost" icon="shield" onClick=${previewSync}>Preview (dry run)</${Button}>` : null}
      <span class="spacer" />
      <${Button} variant="subtle" onClick=${() => (confirm.value = null)}>Cancel</${Button}>
      <${Button} variant=${pending.danger ? "danger" : "ok"} onClick=${confirmOk}>${pending.ok || "Confirm"}</${Button}>
    `}
  >
    <p class="meta">${pending.body}</p>
    ${pending.next?.type === "download"
      ? html`<${Switch}
          danger
          checked=${pending.delete_extras}
          label="Delete local files that are not in GitHub"
          hint="Cannot be undone from this app. Ignored files are always protected."
          onChange=${(checked) => (confirm.value = { ...pending, delete_extras: checked })}
        />`
      : null}
    ${isSync
      ? html`<p class="meta note"><${Icon} name="shield" size=${13} /> Preview runs the same plan read-only — no files, commits or sync history change.</p>`
      : null}
  </${Modal}>`;
}

/** GitHub access setup: operation mode, allowlist, scope or fine-grained token. */
function AuthSetupDialog() {
  const draft = authSetup.value;
  if (!draft) return null;
  const update = (patch) => (authSetup.value = { ...draft, ...patch });
  return html`<${Modal}
    title=${draft.editing ? "GitHub options" : "Connect GitHub"}
    subtitle="Limits are stored with the connection and enforced by this app for manual and automatic sync."
    onClose=${() => (authSetup.value = null)}
    size="lg"
  >
    <section class="dialog-section">
      <h4><${Icon} name="zap" size=${15} /> Operation mode</h4>
      <div class="radio-row">
        ${[
          { value: "read", label: "Read-only", hint: "Check and Download only — no commits, mappings still tuneable." },
          { value: "write", label: "Read & write", hint: "Adds Upload and automatic uploads." },
        ].map(
          (option) => html`<label class=${`radio-card ${draft.mode === option.value ? "selected" : ""}`} key=${option.value}>
            <input
              type="radio"
              name="gs-mode"
              value=${option.value}
              checked=${draft.mode === option.value}
              onChange=${() => update({ mode: option.value })}
            />
            <span class="radio-title">${option.label}</span>
            <span class="field-hint">${option.hint}</span>
          </label>`
        )}
      </div>
    </section>

    <section class="dialog-section">
      <h4><${Icon} name="layers" size=${15} /> Allowed repositories</h4>
      <${Field} label="One owner/repo per line" hint="App-side limits only — they narrow what this app does, not what the GitHub grant could do. Leave empty to allow every repository the account can see.">
        <textarea
          class="mono small"
          rows="3"
          value=${draft.repositories}
          placeholder="sandrod/home-assistant-config"
          onInput=${(ev) => update({ repositories: ev.target.value })}
        />
      </${Field}>
    </section>

    <section class="dialog-section">
      <h4><${Icon} name="key" size=${15} /> Authorization method</h4>
      <${Field} label="Device scope" hint=${SCOPES.find((scope) => scope.value === draft.scope)?.hint || ""}>
        <select value=${draft.scope} onChange=${(ev) => update({ scope: ev.target.value })}>
          ${SCOPES.map((scope) => html`<option key=${scope.value} value=${scope.value}>${scope.label}</option>`)}
        </select>
      </${Field}>
      <${Banner} tone="warning" icon="warning" title="GitHub grants are broader than app limits">
        The chosen OAuth scope is what GitHub grants. This app additionally enforces the mode and allowlist above, but the grant itself is not narrowed by it.
      </${Banner}>
      <div class="row">
        ${draft.editing
          ? html`<${Button} variant="ok" icon="check" onClick=${saveAccess}>Save changes</${Button}>`
          : html`<${Button} icon="github" onClick=${startDeviceAuth}>Authorise with device code</${Button}>`}
        <${Button} variant="ghost" onClick=${() => (authSetup.value = null)}>Cancel</${Button}>
      </div>
    </section>

    <details class="dialog-section collapse">
      <summary><${Icon} name="github" size=${15} /> GitHub App installations & repository access</summary>
      <p class="meta">
        If you are using a GitHub App or want to install and configure repository access on GitHub,
        manage your installed repositories directly in GitHub Settings:
      </p>
      <div class="row">
        <a class="btn ghost sm" href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">
          <${Icon} name="github" size=${15} />
          <span class="btn-label">Manage GitHub App installations</span>
          <${Icon} name="external" size=${14} />
        </a>
      </div>
    </details>

    <details class="dialog-section collapse">
      <summary><${Icon} name="lock" size=${15} /> Use a fine-grained token instead (GitHub-enforced limits)</summary>
      <p class="meta">
        Create the token at GitHub → Settings → Developer settings → Fine-grained tokens: pick the resource owner, <strong>Only select repositories</strong>,
        then set <strong>Contents</strong> to Read-only or Read and write and an expiration. Metadata read is automatic; uploading workflows needs Workflows write.
      </p>
      <a class="link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
        Create a fine-grained token <${Icon} name="external" size=${13} />
      </a>
      <${Field} label="Fine-grained token" hint="Stored only by this app; never returned by the API and never kept in UI state.">
        <input id="github-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" />
      </${Field}>
      <div class="row">
        <${Button} variant="ghost" icon="key" onClick=${connectToken} disabled=${draft.editing}>Connect with token</${Button}>
        <${Button} variant="subtle" onClick=${() => saveAccess()}>Save limits only</${Button}>
      </div>
    </details>

    <p class="meta">Changing limits or logging out does not revoke GitHub grants — revoke or narrow them in GitHub Settings → Applications.</p>
  </${Modal}>`;
}

/** Device-code popup: big copyable code + live approval polling. */
function DeviceDialog() {
  const popup = devicePopup.value;
  if (!popup) return null;
  if (popup.status === "error") {
    return html`<${Modal} title="Authorization failed" size="sm" onClose=${cancelDeviceAuth}
      footer=${html`<${Button} onClick=${cancelDeviceAuth}>Close</${Button}>`}
    >
      <${Banner} tone="error" icon="warning" title="GitHub did not confirm the authorization">${popup.error || "The device flow was not completed."}</${Banner}>
      <p class="meta">Retry from the header or Settings — previous attempts do not change access.</p>
    </${Modal}>`;
  }
  const link = popup.verification_uri_complete || popup.verification_uri;
  const minutes = Math.ceil(Number(popup.expires_in || 900) / 60);
  return html`<${Modal}
    title="Authorise with GitHub"
    subtitle=${popup.copied ? "Code copied to your clipboard" : "Copy the code, then approve it on github.com"}
    size="sm"
    onClose=${cancelDeviceAuth}
  >
    <button type="button" class="device-code" title="Copy code" onClick=${copyDeviceCode}>${popup.user_code}</button>
    <div class="row center">
      <a class="btn primary" href=${link} target="_blank" rel="noopener noreferrer">
        <${Icon} name="external" size=${16} /> Open GitHub
      </a>
      <${Button} variant="ghost" icon="copy" onClick=${copyDeviceCode}>${popup.copied ? "Copied" : "Copy code"}</${Button}>
    </div>
    <p class="meta center-note mono">${popup.verification_uri || "https://github.com/login/device"}</p>
    <p class="meta center-note">
      <span class="spinner inline" /> Waiting for approval — this dialog closes by itself. The code expires in about ${minutes} minutes.
    </p>
  </${Modal}>`;
}

/** Global error banner text (used by the app shell). */
export function ErrorBanner() {
  if (!error.value) return null;
  return html`<${Banner} tone="error" icon="warning" title="Something went wrong">${error.value}</${Banner}>`;
}

/** Update banner shown above the content when a new version is known. */
export function UpdateBanner({ visible, dismiss, install }) {
  if (!visible) return null;
  const up = updates.value || {};
  return html`<div class="banner update">
    <span class="banner-icon"><${Icon} name="sparkles" size=${18} /></span>
    <div class="banner-text">
      <strong>Version ${up.latest_version} is available</strong>
      <span>You are running v${up.current_version || "unknown"}.</span>
    </div>
    <div class="banner-actions">
      ${up.source === "supervisor" && !up.error
        ? html`<${Button} variant="ok" size="sm" icon="sparkles" onClick=${install}>Update now</${Button}>`
        : html`<${Badge} tone="neutral">install from the App store</${Badge}>`}
      <${Button} variant="subtle" size="sm" onClick=${dismiss}>Later</${Button}>
    </div>
  </div>`;
}

/** All overlays in one place so the shell stays readable. */
export function Overlays() {
  return html`<div class="overlay-layer">
    <${ConfirmDialog} />
    <${AuthSetupDialog} />
    <${DeviceDialog} />
    <${BusyOverlay} job=${busy.value} updating=${updating.value} version=${(updates.value || {}).latest_version} />
    <${ToastStack} toasts=${toasts.value} onDismiss=${dismissToast} />
  </div>`;
}
