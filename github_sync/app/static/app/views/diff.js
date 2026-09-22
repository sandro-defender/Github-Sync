/** Results of Check, and the read-only dry-run plans for Upload / Download. */
import { html } from "../deps.js";
import { askDownload, askUpload, closeDiff } from "../actions.js";
import { bytes, count, shortSha } from "../format.js";
import { diff, diffFilter, mappings } from "../state.js";
import { Badge, Banner, Button, Card, Stat } from "../ui.js";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "add", label: "Local only" },
  { key: "mod", label: "Changed" },
  { key: "del", label: "Remote only" },
  { key: "conflict", label: "Conflicts" },
];

/** Flatten a check payload into table rows. */
export function checkRows(results) {
  const conflicts = new Set((results.conflicts || []).map((file) => file.path));
  return [
    ...(results.added || []).map((file) => ({ ...file, kind: "add", label: "local only" })),
    ...(results.modified || [])
      .filter((file) => !conflicts.has(file.path))
      .map((file) => ({ ...file, kind: "mod", label: "changed" })),
    ...(results.removed_locally || []).map((file) => ({ ...file, kind: "del", label: "remote only" })),
    ...(results.conflicts || []).map((file) => ({ ...file, kind: "conflict", label: "conflict" })),
  ];
}

/** Filter chips + counts for the check table. */
function FilterBar({ rows }) {
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] || 0) + 1 }), {});
  return html`<div class="filter-bar">
    ${FILTERS.map(
      (item) => html`<button
        type="button"
        key=${item.key}
        class=${`chip filter ${diffFilter.value === item.key ? "active" : ""}`}
        onClick=${() => {
          diffFilter.value = item.key;
        }}
      >
        ${item.label}${item.key === "all" ? "" : ` ${counts[item.key] || 0}`}
      </button>`
    )}
  </div>`;
}

/** File table shared by Check and dry-run results. */
export function FileTable({ rows, emptyLabel, actionColumn = false }) {
  if (!rows.length) return html`<p class="meta">${emptyLabel}</p>`;
  return html`<div class="table-wrap">
    <table class="diff">
      <thead>
        <tr>
          <th>File</th>
          <th>${actionColumn ? "Planned action" : "Status"}</th>
          <th class="right">Size</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 400).map(
          (row) => html`<tr key=${`${row.kind || row.action}-${row.path}`}>
            <td class="mono path" title=${row.path}>${row.path}</td>
            <td>
              ${actionColumn
                ? html`<${Badge} tone=${row.action === "delete" ? "error" : row.action === "create" ? "success" : "warning"}>${row.action}</${Badge}>`
                : html`<span class=${`tag ${row.kind}`}>${row.label}</span>`}
            </td>
            <td class="right meta">${row.size === undefined || row.size === null ? "" : bytes(row.size)}</td>
          </tr>`
        )}
      </tbody>
    </table>
    ${rows.length > 400
      ? html`<p class="warning-text">Showing the first 400 of ${rows.length} rows — the counters above include everything.</p>`
      : null}
  </div>`;
}

/** Check result: what would move in each direction. */
export function CheckResult({ results, mapping }) {
  const rows = checkRows(results);
  const visible = diffFilter.value === "all" ? rows : rows.filter((row) => row.kind === diffFilter.value);
  return html`<div class="stack">
    <${Card}
      title="Update check"
      subtitle=${`${results.repository} @ ${results.branch} · ${shortSha(results.commit_sha)}`}
      icon="eye"
      actions=${html`<${Button} variant="ghost" size="sm" icon="back" onClick=${closeDiff}>Back</${Button}>`}
    >
      <div class="stats">
        <${Stat} value=${results.upload_count} label="would upload" tone="up" />
        <${Stat} value=${results.download_count} label="would download" tone="down" />
        <${Stat} value=${results.unchanged} label="unchanged" />
        <${Stat} value=${(results.conflicts || []).length} label="conflicts" tone=${(results.conflicts || []).length ? "warn" : ""} />
      </div>
      ${results.empty_repo
        ? html`<${Banner} tone="info" icon="info" title="The remote branch is empty">Upload creates the first commit.</${Banner}>`
        : null}
      ${(results.conflicts || []).length
        ? html`<${Banner} tone="warning" icon="warning" title="Conflicts detected">
            These files changed on both sides since the last successful sync. Uploading keeps the local version, downloading keeps the GitHub version.
          </${Banner}>`
        : null}
      <${FilterBar} rows=${rows} />
      <${FileTable} rows=${visible} emptyLabel="Local and remote match (for files that are not ignored)." />
    </${Card}>

    <div class="row">
      <${Button} variant="primary" icon="upload" onClick=${() => askUpload(mapping ?? mappingFor(results), results.mapping_id)}>Upload</${Button}>
      <${Button} variant="ghost" icon="download" onClick=${() => askDownload(mapping ?? mappingFor(results), results.mapping_id)}>Download</${Button}>
    </div>
  </div>`;
}

/** Look up the mapping a result belongs to (for confirmation copy). */
export function mappingFor(results) {
  return (mappings.value || []).find((item) => item.id === results?.mapping_id);
}

/** Read-only plan produced by a dry run. */
export function DryRunResult({ plan }) {
  const rows = (plan.actions || []).map((action) => ({ ...action, kind: action.action }));
  return html`<${Card}
    title=${`${plan.direction === "upload" ? "Upload" : "Download"} preview`}
    subtitle=${`${plan.repository} @ ${plan.branch} → ${plan.target || (plan.direction === "upload" ? "GitHub" : "local files")}`}
    icon="shield"
    actions=${html`<${Button} variant="ghost" size="sm" icon="back" onClick=${closeDiff}>Back</${Button}>`}
  >
    <${Banner} tone="info" icon="shield" title="Nothing was written">
      No files, GitHub objects or sync history were changed. This is a point-in-time plan, not a reservation.
    </${Banner}>
    <div class="stats">
      <${Stat} value=${plan.create_count} label="would create" tone="up" />
      <${Stat} value=${plan.update_count} label="would overwrite" />
      <${Stat} value=${plan.delete_count} label="would delete" tone=${plan.delete_count ? "warn" : ""} />
      <${Stat} value=${plan.unchanged} label="unchanged" />
    </div>
    <p class="meta">${count(plan.skipped || 0, "file")} skipped · ${shortSha(plan.commit_sha)}</p>
    ${plan.delete_count
      ? html`<${Banner} tone="warning" icon="warning" title=${`${count(plan.delete_count, "deletion")} in this plan`}>
          ${plan.direction === "upload"
            ? "Upload replaces the mapped subtree — a remote file absent from the upload is deleted even if it is ignored locally."
            : "Delete local extras was enabled for this preview."}
        </${Banner}>`
      : null}
    <${FileTable} rows=${rows} actionColumn emptyLabel="No file changes planned." />
  </${Card}>`;
}

/** Router entry: dry-run plans and check results share one view. */
export function DiffView() {
  const results = diff.value;
  if (!results) return null;
  return results.dry_run
    ? html`<div class="stack"><${DryRunResult} plan=${results} /></div>`
    : html`<div class="stack"><${CheckResult} results=${results} mapping=${mappingFor(results)} /></div>`;
}
