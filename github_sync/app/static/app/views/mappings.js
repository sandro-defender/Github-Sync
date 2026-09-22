/** Mappings page: search, mapping cards, first-run empty states. */
import { html } from "../deps.js";
import {
  askDownload,
  askUpload,
  checkMapping,
  editMapping,
  openAuthSetup,
  refresh,
  removeMapping,
  startNewMapping,
} from "../actions.js";
import { directionLabel, intervalLabel, lastSyncLabel, matchesQuery } from "../format.js";
import { loading, mappingQuery, mappings, isConfigured, status, view } from "../state.js";
import { Badge, Banner, Button, Card, EmptyState, Icon, Skeleton } from "../ui.js";

/** GitHub link for a mapping (opens in a new tab). */
function repoUrl(mapping) {
  const branch = mapping.branch ? `/tree/${encodeURIComponent(mapping.branch)}` : "";
  const sub = mapping.repo_path ? `/${mapping.repo_path.replace(/^\/+/, "")}` : "";
  return `https://github.com/${mapping.repository}${branch}${sub}`;
}

/** Sync state drives the coloured dot and the card accent. */
export function mappingState(mapping) {
  if (mapping.last_error) return { tone: "error", label: mapping.last_error };
  if (!mapping.last_sync) return { tone: "idle", label: "Never synced" };
  if (mapping.auto_sync) return { tone: "auto", label: "Synced automatically" };
  return { tone: "ok", label: "In sync" };
}

/** One folder ↔ repository pair with its actions. */
export function MappingCard({ mapping }) {
  const state = mappingState(mapping);
  const last = mapping.last_sync;
  return html`<article class=${`card mapping ${state.tone}`}>
    <header class="mapping-head">
      <span class=${`status-dot ${state.tone}`} title=${state.label} />
      <div class="mapping-title">
        <h3>${mapping.name || mapping.local_path}</h3>
        <div class="mapping-sub">
          <a class="mono-link" href=${repoUrl(mapping)} target="_blank" rel="noopener noreferrer" title="Open on GitHub">
            <${Icon} name="github" size=${14} /> ${mapping.repository}
            <${Icon} name="external" size=${12} />
          </a>
          <span class="sep">·</span>
          <${Badge} tone="neutral" icon="branch">${mapping.branch || "main"}</${Badge}>
          ${mapping.repo_path ? html`<${Badge} tone="neutral" icon="folder">${mapping.repo_path}</${Badge}>` : null}
        </div>
      </div>
    </header>

    <dl class="mapping-meta">
      <div>
        <dt>Local folder</dt>
        <dd class="mono">${mapping.local_path}</dd>
      </div>
      <div>
        <dt>Last sync</dt>
        <dd>
          ${lastSyncLabel(last)}
          ${last ? html`<span class="meta"> · ${directionLabel(last.direction)}</span>` : null}
        </dd>
      </div>
      <div>
        <dt>Auto-sync</dt>
        <dd>
          ${mapping.auto_sync
            ? html`<${Badge} tone="auto" icon="clock">${directionLabel(mapping.auto_direction)} · ${intervalLabel(mapping.auto_interval_minutes)}</${Badge}>`
            : html`<span class="meta">Off</span>`}
        </dd>
      </div>
    </dl>

    ${last?.file_shas_truncated
      ? html`<p class="meta note"><${Icon} name="info" size=${13} /> Conflict snapshot capped at 5000 files — deep history checks are approximate for this folder.</p>`
      : null}
    ${mapping.last_error
      ? html`<p class="meta note error"><${Icon} name="warning" size=${13} /> Last error: ${mapping.last_error}</p>`
      : null}

    <footer class="mapping-actions">
      <${Button} variant="ghost" size="sm" icon="eye" onClick=${() => checkMapping(mapping.id)}>Check</${Button}>
      <${Button} variant="primary" size="sm" icon="upload" onClick=${() => askUpload(mapping)}>Upload</${Button}>
      <${Button} variant="ghost" size="sm" icon="download" onClick=${() => askDownload(mapping)}>Download</${Button}>
      <span class="spacer" />
      <${Button} variant="subtle" size="sm" icon="pencil" onClick=${() => editMapping(mapping)}>Edit</${Button}>
      <${Button} variant="danger" size="sm" icon="trash" onClick=${() => removeMapping(mapping)}>Remove</${Button}>
    </footer>
  </article>`;
}

/** Toolbar with search + add button. */
function Toolbar({ count }) {
  return html`<div class="toolbar">
    <div class="search">
      <${Icon} name="search" size=${16} />
      <input
        type="search"
        placeholder="Filter by folder, repository, branch…"
        value=${mappingQuery.value}
        onInput=${(ev) => {
          mappingQuery.value = ev.target.value;
        }}
      />
      ${mappingQuery.value
        ? html`<button type="button" class="search-clear" aria-label="Clear filter" onClick=${() => (mappingQuery.value = "")}>
            <${Icon} name="close" size=${14} />
          </button>`
        : null}
    </div>
    <span class="meta">${count} mapping${count === 1 ? "" : "s"}</span>
    <${Button} icon="plus" onClick=${startNewMapping}>Add folder sync</${Button}>
  </div>`;
}

/** Loading placeholders for the first paint. */
function MappingsSkeleton() {
  return html`<div class="grid">
    ${[0, 1].map((index) => html`<div class="card" key=${index}><${Skeleton} lines=${4} /></div>`)}
  </div>`;
}

/** First-run state before GitHub is connected. */
function ConnectFirst() {
  return html`<${EmptyState}
    icon="github"
    title="Connect GitHub to get started"
    body="Authorize this app once — GitHub shows a short code, you approve it on github.com — then every mapping works without leaving Home Assistant."
    actions=${html`<${Button} icon="github" onClick=${() => openAuthSetup()}>Connect GitHub</${Button}>
      <${Button} variant="ghost" icon="sliders" onClick=${() => (view.value = "settings")}>Settings</${Button}>`}
  />`;
}

export function MappingsView() {
  if (loading.value) return html`<${MappingsSkeleton} />`;
  if (!isConfigured.value) return html`<${ConnectFirst} />`;

  const query = mappingQuery.value;
  const visible = (mappings.value || []).filter((mapping) =>
    matchesQuery(query, mapping.name, mapping.local_path, mapping.repository, mapping.branch)
  );
  const failures = (mappings.value || []).filter((mapping) => mapping.last_error).length;

  return html`<div class="stack">
    ${failures
      ? html`<${Banner} tone="warning" icon="warning" title=${`${failures} mapping${failures === 1 ? "" : "s"} reported an error`}>
          Open the mapping, run Check, and read the error line on the card. Auto-sync retries at the next interval.
          <div class="banner-actions-inline"><${Button} variant="ghost" size="sm" icon="refresh" onClick=${() => refresh()}>Refresh</${Button}></div>
        </${Banner}>`
      : null}
    ${Toolbar({ count: (mappings.value || []).length })}
    ${visible.length
      ? html`<div class="grid">${visible.map((mapping) => html`<${MappingCard} key=${mapping.id} mapping=${mapping} />`)}</div>`
      : html`<${EmptyState}
          icon=${query ? "search" : "layers"}
          title=${query ? "No mapping matches that filter" : "No folders mapped yet"}
          body=${query
            ? "Try a different folder, repository or branch name."
            : "Pick a Home Assistant folder, point it at a GitHub repository, tune the ignore rules, then upload or download."}
          actions=${query
            ? html`<${Button} variant="ghost" onClick=${() => (mappingQuery.value = "")}>Clear filter</${Button}>`
            : html`<${Button} icon="plus" onClick=${startNewMapping}>Add folder sync</${Button}>`}
        />`}
    ${status.value?.roots?.length
      ? html`<${Card} title="Available mounts" subtitle="Folders this app can read and write" icon="layers">
          <div class="chips">${status.value.roots.map((root) => html`<${Badge} key=${root} tone="neutral" icon="folder">${root}</${Badge}>`)}</div>
        </${Card}>`
      : null}
  </div>`;
}
