/**
 * File explorer: the mapped folder as a tree you can tick.
 *
 * One row per file *and* per folder, at every depth. A folder opens on click
 * and loads just its own children (`api/preview_tree`), so a 10 000-file
 * folder is explorable instead of hiding behind a "… and N more" hint; huge
 * levels page with **Show more**, and the filter box searches the whole folder,
 * including inside folders your rules ignore.
 *
 * Ticking a folder never enumerates its files: the row writes one folder rule
 * that gitignore applies to everything below it (see `applyFolderToggle` in
 * `actions.js`), so a folder that was never listed is still ticked completely.
 */
import { html } from "../deps.js";
import {
  checkAllPaths,
  collapseAllFolders,
  expandAllFolders,
  refreshExplorer,
  resetExplorerRules,
  setExplorerQuery,
  showMoreInFolder,
  toggleIgnoredFolder,
  toggleIgnoredPath,
  toggleTreeFolder,
  uncheckAllPaths,
} from "../actions.js";
import { bytes, count } from "../format.js";
import { ignoreSide, tree, treeDownload, treeExpanded, treeQuery, treeUpload } from "../state.js";
import { Badge, Banner, Button, Card, Icon, Spinner } from "../ui.js";

/** Row state a checkbox shows: `checked` | `unchecked` | `partial`. */
export function entryState(entry) {
  if (!entry) return "unchecked";
  if (entry.ignored) return "unchecked";
  // Files are binary, and a link to a folder is never walked or synced, so it
  // has nothing inside it to be partly selected about.
  if (!entry.is_dir || entry.symlink) return "checked";
  if (entry.complete === false) return "partial";
  const excluded = Number(entry.excluded) || 0;
  const ignoredDirs = Number(entry.ignored_dirs) || 0;
  if (!excluded && !ignoredDirs) return "checked";
  return Number(entry.included) > 0 || Number(entry.dirs) > 0 ? "partial" : "unchecked";
}

/** `3 of 12 files · 2 folders · 40.1 KB` — what a folder row says about itself. */
export function folderMeta(entry) {
  if (entry.ignored) return entry.pattern || "ignored";
  const files = Number(entry.files) || 0;
  const dirs = Number(entry.dirs) || 0;
  if (!files && !dirs) return entry.symlink ? "not followed" : "empty";
  const bits = [];
  if (files) {
    const partly = (Number(entry.excluded) || 0) > 0 || (Number(entry.ignored_dirs) || 0) > 0;
    bits.push(partly ? `${Number(entry.included) || 0} of ${count(files, "file")}` : count(files, "file"));
  }
  if (dirs) bits.push(count(dirs, "folder"));
  if (Number(entry.included_size) > 0) bits.push(bytes(entry.included_size));
  if (entry.unknown) bits.push("partly scanned");
  return bits.join(" · ");
}

/** What a file row says about itself (its size when synced, the rule when not). */
export function fileMeta(entry) {
  if (entry.ignored) return entry.pattern || "ignored";
  const size = bytes(entry.size);
  return entry.too_large ? `${size} · too large to upload` : size;
}

/**
 * Flatten the loaded levels into the rows to render, depth first.
 *
 * Only folders the user opened are walked, so the row list is exactly what is on
 * screen, and a `kind: "more"` marker lands where a folder has children the
 * server has not sent yet.
 */
export function treeRows(levels, expanded) {
  const open = new Set(expanded || []);
  const rows = [];
  const walk = (path, depth) => {
    const level = levels?.[path];
    if (!level) return;
    const entries = level.entries || [];
    for (const entry of entries) {
      const isOpen = Boolean(entry.is_dir) && entry.can_open !== false && open.has(entry.path);
      rows.push({ kind: "entry", entry, depth, open: isOpen, key: entry.path });
      if (isOpen) walk(entry.path, depth + 1);
    }
    const total = Number(level.total) || 0;
    if (level.has_more || level.capped) {
      rows.push({
        kind: "more",
        path,
        depth,
        hidden: Math.max(0, total - entries.length),
        capped: Boolean(level.capped),
        key: `more:${path || "."}`,
      });
    }
  };
  walk("", 0);
  return rows;
}

/**
 * Checkbox that can also render the third (indeterminate) state.
 *
 * `indeterminate` is a property rather than an attribute, and Preact assigns it
 * in the same diff that sets `checked` — so the dash arrives with the row
 * instead of one tick later. That lag was not cosmetic: a browser flickered a
 * stale tick after every scan, and only an effect could read it back.
 */
function Tickbox({ state, label, onChange }) {
  return html`<input
    type="checkbox"
    class="tree-tick"
    aria-label=${label}
    title=${label}
    checked=${state === "checked"}
    indeterminate=${state === "partial"}
    onChange=${(ev) => onChange?.(ev.target.checked)}
  />`;
}

/** The box that opens or closes a folder (also the row's keyboard handle). */
function Caret({ entry, open, side }) {
  if (entry.can_open === false) return html`<span class="tree-toggle placeholder" aria-hidden="true" />`;
  return html`<button
    type="button"
    class=${`tree-toggle ${open ? "open" : ""}`.trim()}
    aria-label=${`${open ? "Collapse" : "Expand"} ${entry.name}`}
    aria-expanded=${open ? "true" : "false"}
    onClick=${() => toggleTreeFolder(entry.path, side)}
  >
    <${Icon} name=${open ? "chevronDown" : "chevronRight"} size=${14} />
  </button>`;
}

/** One file or folder row of the tree. */
function TreeRow({ row, side }) {
  const entry = row.entry;
  const state = entryState(entry);
  const indent = `padding-left:${6 + row.depth * 16}px`;
  const label = `${state === "partial" ? "Partly included" : state === "checked" ? "Included" : "Ignored"}: ${entry.path}`;

  if (!entry.is_dir) {
    // A file row is a label: clicking anywhere on it toggles the file.
    return html`<label
      class=${`tree-row file ${state}`.trim()}
      key=${row.key}
      style=${indent}
      title=${entry.ignored ? `Ignored by “${entry.pattern || "a rule"}” — tick to include this file` : label}
    >
      <span class="tree-toggle placeholder" aria-hidden="true" />
      <${Tickbox} state=${state} label=${label} onChange=${(next) => toggleIgnoredPath(entry.path, next, entry, side)} />
      <${Icon} name="file" size=${14} />
      <span class="grow mono">${entry.name}</span>
      <span class="meta">${fileMeta(entry)}</span>
    </label>`;
  }

  return html`<div
    class=${`tree-row folder ${state}${row.open ? " open" : ""}${entry.symlink ? " symlink" : ""}`.trim()}
    key=${row.key}
    style=${indent}
    title=${entry.ignored
      ? `Ignored by “${entry.pattern || "a rule"}” — tick to include the whole folder`
      : "Tick to include or ignore everything inside; click the name to open the folder"}
    onClick=${(ev) => {
      if (entry.can_open !== false && !ev.target.closest("input, button, a")) {
        toggleTreeFolder(entry.path, side);
      }
    }}
  >
    <${Caret} entry=${entry} open=${row.open} side=${side} />
    <${Tickbox} state=${state} label=${label} onChange=${(next) => toggleIgnoredFolder(entry.path, next, entry, side)} />
    <${Icon} name="folder" size=${14} />
    ${entry.can_open === false
      ? html`<span class="grow mono">${entry.name}</span>`
      : html`<button type="button" class="grow tree-name mono" onClick=${() => toggleTreeFolder(entry.path, side)}>
          ${entry.name}
        </button>`}
    ${entry.symlink ? html`<${Badge} tone="neutral">link</${Badge}>` : null}
    <span class="meta">${folderMeta(entry)}</span>
  </div>`;
}

/**
 * Footer of a level that could not be shown in full.
 *
 * Normally that is just the next page ("Show more"). In the rare case the
 * server capped the listing itself, paging further would never finish, so the
 * row says so and points at the filter instead — the files are still there and
 * still tickable, just not worth scrolling to.
 */
function MoreRow({ row, loading, side }) {
  return html`<div class="tree-more" key=${row.key} style=${`padding-left:${6 + (row.depth + 1) * 16}px`}>
    ${row.capped
      ? html`<${Icon} name="search" size=${13} />
          <span class="meta">
            not every entry of this folder is listed — the filter below finds the rest
          </span>`
      : html`<${Button}
          variant="ghost"
          size="sm"
          icon=${loading ? undefined : "chevronDown"}
          disabled=${loading}
          onClick=${() => showMoreInFolder(row.path, side)}
        >
          ${loading ? html`<${Spinner} size=${13} />` : "Show more"}
        </${Button}>
        <span class="meta">
          ${row.hidden > 0
            ? `${count(row.hidden, "entry", "entries")} more in ${row.path || "this folder"}`
            : "more entries in this folder"}
        </span>`}
  </div>`;
}

/** A search hit: the full path is shown because the tree stays collapsed. */
function SearchRow({ entry, index, side }) {
  const state = entryState(entry);
  const folder = entry.is_dir && entry.can_open !== false;
  const label = `${state === "partial" ? "Partly included" : state === "checked" ? "Included" : "Ignored"}: ${entry.path}`;
  return html`<div class=${`tree-row search ${folder ? "folder" : "file"} ${state}`.trim()} key=${`hit:${index}`}>
    <span class="tree-toggle placeholder" aria-hidden="true" />
    <${Tickbox}
      state=${state}
      label=${label}
      onChange=${(next) =>
        folder ? toggleIgnoredFolder(entry.path, next, entry, side) : toggleIgnoredPath(entry.path, next, entry, side)}
    />
    <${Icon} name=${folder ? "folder" : "file"} size=${14} />
    <span class="grow mono">${entry.path}</span>
    ${entry.ignored ? html`<${Badge} tone="neutral" title=${`Ignored by “${entry.pattern || "a rule"}”`}>ignored</${Badge}>` : null}
    <span class="meta">${folder ? folderMeta(entry) : fileMeta(entry)}</span>
  </div>`;
}

/**
 * The explorer card the mapping wizard shows on its "Ignore rules" step.
 *
 * Upload and download each keep their own rule set, so `side` decides
 * which textarea the checkboxes edit; the folder tree itself is the same on
 * disk, so which folders are open survives switching sides.
 */
export function FileExplorer({ side } = {}) {
  const activeSide = side || ignoreSide.value;
  const targetSignal = activeSide === "download" ? treeDownload : treeUpload;
  const data = targetSignal.value || (ignoreSide.value === activeSide ? tree.value : null) || tree.value;
  const query = String(treeQuery.value || "");
  const loading = Boolean(data?.loading);
  const search = data?.search || null;
  const rows = data && !search ? treeRows(data.levels, treeExpanded.value) : [];
  const root = data?.root || {};
  const included = Number(root.included) || 0;
  const files = Number(root.files) || 0;
  const ignored = Number(root.excluded) || 0;
  // Counts are only as good as the scan: while it is cut short, never grey a
  // bulk button out — a folder or catch-all rule still covers every file.
  const unsure = Boolean(data) && (root.complete === false || data.truncated);
  const canUncheck = !data || unsure || included > 0 || Number(root.dirs) > 0;
  const canCheck = !data || unsure || ignored > 0 || Number(root.ignored_dirs) > 0 || included < files;

  return html`<${Card}
    title="File explorer"
    subtitle=${`${activeSide === "download" ? "Download" : "Upload"} — open a folder and tick exactly what to sync`}
    icon="folder"
    actions=${html`<${Button}
        variant="ghost"
        size="sm"
        icon="check"
        title="Include everything on this side (writes !**, which overrides the rules above)"
        disabled=${!canCheck}
        onClick=${() => checkAllPaths(activeSide)}
      >Check all</${Button}>
      <${Button}
        variant="ghost"
        size="sm"
        icon="close"
        title="Ignore everything on this side, then tick only what to sync (writes one * rule)"
        disabled=${!canUncheck}
        onClick=${() => uncheckAllPaths(activeSide)}
      >Uncheck all</${Button}>
      <${Button}
        variant="ghost"
        size="sm"
        icon="trash"
        title="Delete the rules the explorer wrote; the rules above stay untouched"
        onClick=${() => resetExplorerRules(activeSide)}
      >Reset selection</${Button}>`}>
    ${data?.error
      ? html`<${Banner} tone="error" icon="warning" title="The folder could not be listed">
          ${data.error}
          <${Button} variant="ghost" size="sm" icon="refresh" onClick=${() => refreshExplorer({ side: activeSide })}>Retry</${Button}>
        </${Banner}>`
      : null}

    <div class="explorer-bar">
      <input
        type="search"
        class="explorer-filter"
        value=${query}
        placeholder="Search files and folders in this mapping"
        aria-label="Search the file explorer"
        onInput=${(ev) => setExplorerQuery(ev.target.value)}
      />
      ${query
        ? html`<button type="button" class="explorer-clear" onClick=${() => setExplorerQuery("")}>
            <${Icon} name="close" size=${13} /> Clear
          </button>`
        : null}
      <span class="spacer" />
      <${Button} variant="ghost" size="sm" icon="chevronDown" onClick=${() => expandAllFolders(activeSide)}>Expand all</${Button}>
      <${Button} variant="ghost" size="sm" icon="back" onClick=${() => collapseAllFolders(activeSide)}>Collapse</${Button}>
    </div>

    ${data
      ? html`<div class="explorer-stats">
          <span class="meta">
            <b>${included}</b> of ${count(files, "file")} synced · <b>${ignored}</b> ignored ·
            ${bytes(root.included_size)}
          </span>
          ${root.complete === false || data.truncated
            ? html`<${Badge}
                tone="warning"
                icon="warning"
                title="The scan stopped at its entry limit, so counts and the deepest rows are partial. Folder rules still apply to everything inside the folder.">
                scan limit</${Badge}>`
            : null}
          ${loading ? html`<span class="meta explorer-loading"><${Spinner} size=${13} /> refreshing</span>` : null}
        </div>`
      : null}

    ${!data
      ? html`<div class="list tree">
          <div class="list-row muted"><${Spinner} size=${16} /> Listing the folder…</div>
        </div>`
      : html`<div class="list tree">
          ${search
            ? html`<div class="tree-search-head">
                ${search.total
                  ? `${count(search.total, "match", "matches")} for “${search.query}” — tick them here, no need to open the folders`
                  : `Nothing in this folder matches “${search.query}”.`}
              </div>`
            : null}
          ${search
            ? (search.entries || []).map((entry, index) => html`<${SearchRow} entry=${entry} index=${index} side=${activeSide} />`)
            : rows.map((row) =>
                row.kind === "more"
                  ? html`<${MoreRow} row=${row} loading=${loading} side=${activeSide} />`
                  : html`<${TreeRow} row=${row} side=${activeSide} />`
              )}
          ${!search && !(data.levels?.[""]?.entries || []).length
            ? html`<div class="list-row muted">This folder has no files to list.</div>`
            : null}
        </div>`}

    <p class="meta explorer-hint">
      Tick a folder to include or ignore <em>everything</em> inside it — one rule, so it also covers files the
      explorer has not listed yet. Click a folder name (or its arrow) to open it, and use the box on any file to
      pick single files. A level that does not fit on one page ends in
      <b>Show more</b>, and the search box finds a file anywhere in the folder — including inside ignored ones —
      so nothing is out of reach. Every rule lands in the textarea above inside the explorer's own block.
    </p>
  </${Card}>`;
}
