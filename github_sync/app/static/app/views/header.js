/** Sticky app header: brand, account chip + menu, version chip, refresh. */
import { html } from "../deps.js";
import { logout, openAuthSetup, refresh } from "../actions.js";
import {
  busy,
  isConfigured,
  latestVersion,
  status,
  updateAvailable,
  updating,
  updates,
  userMenuOpen,
  version,
  view,
} from "../state.js";
import { Badge, Icon, IconButton } from "../ui.js";

/** Refresh button that spins while a job is running. */
function RefreshButton() {
  return html`<${IconButton}
    name="refresh"
    label=${busy.value ? "Working…" : "Refresh"}
    spin=${Boolean(busy.value) || Boolean(updating.value)}
    onClick=${() => refresh()}
  />`;
}

/** Version chip — clicking it jumps to Settings → App updates. */
function VersionChip() {
  const current = version.value;
  if (!current) return null;
  return html`<button
    type="button"
    class="chip version"
    title=${updateAvailable.value ? `Version ${latestVersion.value} is available` : "Installed version"}
    onClick=${() => {
      view.value = "settings";
    }}
  >
    v${current}
    ${updateAvailable.value ? html`<span class="dot pulse" />` : null}
  </button>`;
}

/** Dropdown with GitHub options and log out. */
function AccountMenu({ info }) {
  return html`<div class="menu" role="menu">
    <div class="menu-head">
      <strong>@${info.username || "connected"}</strong>
      <span class="meta">
        ${info.auth_method === "token" ? "Fine-grained token" : "Device authorization"} ·
        ${info.access?.mode === "write" ? "read + write" : "read-only"}
      </span>
    </div>
    <button
      type="button"
      class="menu-item"
      role="menuitem"
      onClick=${() => {
        userMenuOpen.value = false;
        openAuthSetup(true);
      }}
    >
      <${Icon} name="sliders" size=${16} />
      <span class="menu-item-text">GitHub options<em>scope, repositories, permissions</em></span>
    </button>
    <button
      type="button"
      class="menu-item"
      role="menuitem"
      onClick=${() => {
        userMenuOpen.value = false;
        logout();
      }}
    >
      <${Icon} name="logout" size=${16} />
      <span class="menu-item-text">Log out<em>clears local credentials</em></span>
    </button>
  </div>`;
}

/** Account chip (or a Connect chip while signed out) with its dropdown. */
export function AccountChip() {
  const info = status.value || {};
  if (!isConfigured.value) {
    return html`<button type="button" class="chip account connect" onClick=${() => openAuthSetup()}>
      <${Icon} name="github" size=${15} /> Connect
    </button>`;
  }
  return html`<div class="account-wrap">
    <button
      type="button"
      class=${`chip account ${userMenuOpen.value ? "open" : ""}`}
      aria-expanded=${userMenuOpen.value ? "true" : "false"}
      aria-haspopup="menu"
      onClick=${() => {
        userMenuOpen.value = !userMenuOpen.value;
      }}
    >
      <${Icon} name="github" size=${15} />
      <span class="account-name">@${info.username || "connected"}</span>
      <${Icon} name="chevronDown" size=${14} />
    </button>
    ${userMenuOpen.value ? html`<${AccountMenu} info=${info} />` : null}
  </div>`;
}

/** Update hint chip shown when a newer version is known. */
export function UpdateChip() {
  if (!updateAvailable.value || updating.value) return null;
  return html`<${Badge} tone="success" icon="sparkles" title=${`Version ${latestVersion.value} is available`}>
    ${latestVersion.value}
  </${Badge}>`;
}

export function Header() {
  const info = updates.value || {};
  return html`<header class="app-header">
    <div class="brand">
      <img class="brand-mark" src="assets/icon.png" alt="" width="34" height="34" />
      <div class="brand-text">
        <h1>GitHub Sync</h1>
        <span class="brand-sub">Home Assistant ⇄ GitHub</span>
      </div>
    </div>
    <div class="header-actions">
      ${info.error ? html`<${Badge} tone="warning" icon="warning" title=${info.error}>update check</${Badge}>` : null}
      <${UpdateChip} />
      <${AccountChip} />
      <${VersionChip} />
      <${RefreshButton} />
    </div>
  </header>`;
}
