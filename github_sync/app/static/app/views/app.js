/** App shell: header, navigation, routed view and overlays. */
import { html, useEffect, useErrorBoundary } from "../deps.js";
import { askUpdate, dismissUpdateBanner } from "../actions.js";
import { isConfigured, loading, updateBannerVisible, userMenuOpen, view } from "../state.js";
import { Button, EmptyState, Icon } from "../ui.js";
import { Header } from "./header.js";
import { MappingsView } from "./mappings.js";
import { EditorView } from "./editor.js";
import { DiffView } from "./diff.js";
import { SettingsView } from "./settings.js";
import { ErrorBanner, Overlays, UpdateBanner } from "./dialogs.js";

const TABS = [
  { key: "list", label: "Mappings", icon: "layers" },
  { key: "settings", label: "Settings", icon: "sliders" },
];

/** Segmented navigation; the editor and diff views belong to the Mappings tab. */
function Tabs() {
  const active = view.value === "settings" ? "settings" : "list";
  return html`<nav class="tabs" role="tablist" aria-label="Sections">
    ${TABS.map(
      (tab) => html`<button
        type="button"
        role="tab"
        key=${tab.key}
        aria-selected=${active === tab.key ? "true" : "false"}
        class=${`tab ${active === tab.key ? "active" : ""}`}
        onClick=${() => {
          view.value = tab.key;
        }}
      >
        <${Icon} name=${tab.icon} size=${16} />
        <span>${tab.label}</span>
        ${tab.key === "settings" && updateBannerVisible.value ? html`<span class="dot pulse" />` : null}
      </button>`
    )}
  </nav>`;
}

/** Content router. */
function CurrentView() {
  switch (view.value) {
    case "editor":
      return html`<${EditorView} />`;
    case "diff":
      return html`<${DiffView} />`;
    case "settings":
      return html`<${SettingsView} />`;
    default:
      return html`<${MappingsView} />`;
  }
}

/** Close the account menu when clicking anywhere outside of it. */
function useClickAway() {
  useEffect(() => {
    const onClick = (ev) => {
      if (userMenuOpen.value && !ev.target.closest?.(".account-wrap")) userMenuOpen.value = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

/** Top-level error boundary: a render crash must not blank the panel. */
export function Shell() {
  const [shellError, reset] = useErrorBoundary();
  useClickAway();

  if (shellError) {
    return html`<div class="page">
      <${EmptyState}
        icon="warning"
        title="The panel hit an unexpected error"
        body=${String(shellError?.message || shellError)}
        actions=${html`<${Button} icon="refresh" onClick=${() => reset()}>Try again</${Button}>
          <${Button} variant="ghost" icon="refresh" onClick=${() => location.reload()}>Reload page</${Button}>`}
      />
    </div>`;
  }

  return html`<div class="shell">
    <${Header} />
    <${Tabs} />
    <main class=${`page ${loading.value ? "is-loading" : ""}`} id="content">
      <${ErrorBanner} />
      <${UpdateBanner} visible=${updateBannerVisible.value} dismiss=${dismissUpdateBanner} install=${askUpdate} />
      <${CurrentView} />
      ${!isConfigured.value && view.value === "settings" && !loading.value
        ? html`<p class="meta center-note">Connect GitHub to unlock mappings, file browsing and sync.</p>`
        : null}
    </main>
    <${Overlays} />
  </div>`;
}
