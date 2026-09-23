/** Mapping wizard: folder → repository → ignore rules → review. */
import { html } from "../deps.js";
import {
  applyPreset,
  browse,
  closeEditor,
  gotoStep,
  loadRepos,
  openAuthSetup,
  patchEditor,
  pickFolder,
  pickRepo,
  refreshExplorer,
  saveMapping,
  scheduleExplorerRefresh,
  setIgnoreSide,
} from "../actions.js";
import { directionLabel, intervalLabel, matchesQuery } from "../format.js";
import { branches, browser, editor, ignoreSide, presets, repoQuery, repos, status, tree } from "../state.js";
import { Badge, Banner, Button, Card, Field, Icon, Spinner, Switch } from "../ui.js";
import { FileExplorer } from "./explorer.js";

const STEPS = [
  { n: 1, label: "Folder" },
  { n: 2, label: "Repository" },
  { n: 3, label: "Ignore rules" },
  { n: 4, label: "Review" },
];

/** Progress stepper with a connector line. */
function Stepper({ step }) {
  return html`<ol class="stepper">
    ${STEPS.map(
      (item) => html`<li
        key=${item.n}
        class=${`step ${step === item.n ? "current" : ""} ${step > item.n ? "done" : ""}`}
        onClick=${() => gotoStep(item.n)}
      >
        <span class="step-dot">${step > item.n ? html`<${Icon} name="check" size=${13} />` : item.n}</span>
        <span class="step-label">${item.label}</span>
      </li>`
    )}
  </ol>`;
}

/** Step 1 — pick the local folder with the file browser. */
export function FolderStep({ draft }) {
  const listing = browser.value;
  const entries = (listing?.entries || []).filter((entry) => entry.is_dir);
  return html`<div class="stack">
    <${Card} title="Which Home Assistant folder?" icon="folder">
      <${Field} label="Display name" hint="Shown on the mapping card — defaults to the folder name.">
        <input
          type="text"
          value=${draft.name}
          placeholder="ESPHome"
          onInput=${(ev) => patchEditor({ name: ev.target.value })}
        />
      </${Field}>
      <${Field} label="Folder" hint="Paths are relative to the mounted Home Assistant roots.">
        <input
          type="text"
          class="mono"
          value=${draft.local_path}
          placeholder="homeassistant/esphome"
          onInput=${(ev) => patchEditor({ local_path: ev.target.value })}
        />
      </${Field}>
      <div class="row">
        <${Button} variant="ghost" icon="folder" onClick=${() => browse(draft.local_path || "")}>Browse folders</${Button}>
        ${draft.local_path ? html`<${Badge} tone="neutral" icon="check">selected</${Badge}>` : null}
      </div>
    </${Card}>

    ${listing
      ? html`<${Card} title="File browser" subtitle=${listing.path ? `/${listing.path}` : "Mounted folders"} icon="layers">
          <nav class="crumbs">
            <button type="button" onClick=${() => browse("")}>Home Assistant</button>
            ${String(listing.path || "")
              .split("/")
              .filter(Boolean)
              .reduce((acc, part, index, all) => {
                const path = all.slice(0, index + 1).join("/");
                acc.push(html`<span key=${path} class="crumb"><span class="sep">/</span><button type="button" onClick=${() => browse(path)}>${part}</button></span>`);
                return acc;
              }, [])}
          </nav>
          <div class="list">
            ${entries.length
              ? entries.map(
                  (entry) => html`<div class="list-row" key=${entry.path} onClick=${() => browse(entry.path)}>
                    <${Icon} name="folder" size=${16} />
                    <span class="grow">${entry.name}</span>
                    ${entry.is_symlink ? html`<${Badge} tone="neutral">link</${Badge}>` : null}
                    <${Button} variant="ghost" size="sm" onClick=${(ev) => {
                      ev.stopPropagation();
                      pickFolder(entry.path);
                    }}>Select</${Button}>
                  </div>`
                )
              : html`<div class="list-row muted">No subfolders here</div>`}
          </div>
          <div class="row">
            <${Button} variant="primary" size="sm" icon="check" onClick=${() => pickFolder(listing.path || "")}>
              Use ${listing.path ? `/${listing.path}` : "this folder"}
            </${Button}>
          </div>
        </${Card}>`
      : null}
  </div>`;
}

/** Step 2 — repository, branch and optional subpath. */
export function RepoStep({ draft }) {
  const list = repos.value;
  const query = repoQuery.value;
  const visible = (list || []).filter((repo) => matchesQuery(query, repo.full_name, repo.description));
  return html`<div class="stack">
    <${Card} title="Which repository?" icon="github">
      <${Field} label="Repository (owner/name)">
        <input
          type="text"
          class="mono"
          value=${draft.repository}
          placeholder="username/ha-esphome"
          onInput=${(ev) => patchEditor({ repository: ev.target.value })}
        />
      </${Field}>
      <div class="split">
        <${Field} label="Branch">
          <input
            type="text"
            class="mono"
            list="gs-branches"
            value=${draft.branch}
            placeholder="main"
            onInput=${(ev) => patchEditor({ branch: ev.target.value })}
          />
          <datalist id="gs-branches">
            ${(branches.value?.length ? branches.value : ["main"]).map((name) => html`<option key=${name} value=${name} />`)}
          </datalist>
        </${Field}>
        <${Field} label="Path inside the repository" hint="Leave empty to sync the repository root.">
          <input
            type="text"
            class="mono"
            value=${draft.repo_path}
            placeholder="homeassistant/esphome"
            onInput=${(ev) => patchEditor({ repo_path: ev.target.value })}
          />
        </${Field}>
      </div>
    </${Card}>

    <${Card}
      title="Your repositories"
      subtitle=${status.value?.access?.repositories?.length
        ? `Showing ${status.value.access.repositories.length} allowed repository/repositories`
        : "Read from the connected GitHub account"}
      icon="layers"
      actions=${html`<${Button} variant="ghost" size="sm" icon="refresh" onClick=${() => { repos.value = null; loadRepos(); }}>Reload</${Button}>`}
    >
      ${status.value?.access?.repositories?.length
        ? html`<p class="meta note">
            <${Icon} name="info" size=${13} />
            Allowed repositories filter is active. To add more repos, <${Button} variant="ghost" size="sm" onClick=${() => openAuthSetup(true)}>Manage allowed repositories</${Button}>.
          </p>`
        : null}
      <${Field} label="Filter">
        <input type="search" value=${query} placeholder="Search by name or description" onInput=${(ev) => (repoQuery.value = ev.target.value)} />
      </${Field}>
      ${list === null
        ? html`<div class="list-row muted"><${Spinner} size=${16} /> Loading repositories…</div>`
        : html`<div class="list">
            ${visible.length
              ? visible.slice(0, 100).map(
                  (repo) => html`<div
                    key=${repo.full_name}
                    class=${`list-row ${draft.repository === repo.full_name ? "selected" : ""}`}
                    onClick=${() => pickRepo(repo.full_name, repo.default_branch)}
                  >
                    <${Icon} name=${repo.private ? "lock" : "github"} size=${16} />
                    <span class="grow">
                      <span class="mono">${repo.full_name}</span>
                      <em>${repo.description || repo.default_branch || ""}</em>
                    </span>
                    ${repo.private ? html`<${Badge} tone="neutral">private</${Badge}>` : null}
                    ${draft.repository === repo.full_name ? html`<${Badge} tone="success" icon="check">selected</${Badge}>` : null}
                  </div>`
                )
              : html`<div class="list-row muted">No repositories matched “${query}”.</div>`}
          </div>`}
    </${Card}>
  </div>`;
}

/** Step 3 — ignore rules, edited with the live file explorer next to them. */
export function IgnoreStep({ draft }) {
  const side = ignoreSide.value;
  const field = side === "download" ? "ignore_download" : "ignore_upload";
  const presetList = Object.entries(presets.value || {});
  return html`<div class="stack">
    <${Card}
      title="Ignore rules"
      subtitle="Gitignore syntax: globs, **, trailing / for folders, ! to re-include"
      icon="sliders"
    >
      <div class="segmented">
        <button type="button" class=${side === "upload" ? "active" : ""} onClick=${() => setIgnoreSide("upload")}>Upload</button>
        <button type="button" class=${side === "download" ? "active" : ""} onClick=${() => setIgnoreSide("download")}>Download</button>
      </div>
      <div class="chips">
        ${presetList.map(
          (item) => html`<button
            type="button"
            class="chip preset"
            key=${item[0]}
            title=${item[1].patterns}
            onClick=${() => applyPreset(item[0])}
          >
            <${Icon} name="plus" size=${13} /> ${item[1].label}
          </button>`
        )}
      </div>
      <${Field}
        label=${side === "download" ? "Download ignore patterns" : "Upload ignore patterns"}
        hint="The explorer writes its own lines at the end of this list, after its marker comment — delete that block to start over."
      >
        <textarea
          class="mono"
          spellcheck="false"
          value=${draft[field] || ""}
          onInput=${(ev) => {
            patchEditor({ [field]: ev.target.value });
            scheduleExplorerRefresh();
          }}
          onBlur=${() => refreshExplorer()}
        />
      </${Field}>
      <div class="row">
        <${Button} variant="ghost" icon="refresh" onClick=${() => refreshExplorer()}>Re-scan folder</${Button}>
        ${tree.value?.truncated ? html`<${Badge} tone="warning" icon="warning">scan limit</${Badge}>` : null}
      </div>
    </${Card}>

    ${draft.local_path
      ? html`<${FileExplorer} />`
      : html`<${Card} title="File explorer" icon="folder">
          <p class="meta">Choose a folder in step 1 and the explorer lists it here, with a checkbox on every file and folder.</p>
        </${Card}>`}
  </div>`;
}

/** Step 4 — review target, commit message and auto-sync. */
export function ReviewStep({ draft }) {
  return html`<div class="stack">
    <${Card} title="Review" icon="check">
      <dl class="review">
        <div><dt>Local folder</dt><dd class="mono">${draft.local_path || "—"}</dd></div>
        <div><dt>Repository</dt><dd class="mono">${draft.repository || "—"} @ ${draft.branch || "main"}</dd></div>
        <div><dt>Repo path</dt><dd class="mono">${draft.repo_path || "repository root"}</dd></div>
      </dl>
      <${Field} label="Commit message template" hint="Placeholders: {name} {folder} {repository} {timestamp}">
        <input
          type="text"
          value=${draft.commit_message}
          placeholder="chore(ha): sync {name} from Home Assistant"
          onInput=${(ev) => patchEditor({ commit_message: ev.target.value })}
        />
      </${Field}>
    </${Card}>

    <${Card} title="Automatic sync" icon="clock" subtitle="Runs in the background while the app is started">
      <${Switch}
        checked=${draft.auto_sync}
        label="Enable automatic sync"
        hint="Failures raise a persistent Home Assistant notification."
        onChange=${(checked) => patchEditor({ auto_sync: checked })}
      />
      <div class="split">
        <${Field} label="Interval">
          <select
            value=${String(draft.auto_interval_minutes)}
            onChange=${(ev) => patchEditor({ auto_interval_minutes: Number(ev.target.value) })}
          >
            ${[15, 60, 360, 1440].map((n) => html`<option key=${n} value=${String(n)}>${intervalLabel(n)}</option>`)}
          </select>
        </${Field}>
        <${Field} label="Automatic action">
          <select value=${draft.auto_direction} onChange=${(ev) => patchEditor({ auto_direction: ev.target.value })}>
            ${["upload", "download", "check"].map((value) => html`<option key=${value} value=${value}>${directionLabel(value)}</option>`)}
          </select>
        </${Field}>
      </div>
      ${draft.auto_direction === "check"
        ? html`<${Banner} tone="info" icon="info">Check-only never writes: it notifies you when local and remote files differ.</${Banner}>`
        : null}
    </${Card}>
  </div>`;
}

export function EditorView() {
  const draft = editor.value;
  if (!draft) return null;
  const step = draft.step || 1;
  const canContinue = step !== 1 || Boolean(draft.local_path);
  return html`<div class="stack">
    <${Stepper} step=${step} />
    ${step === 1 ? html`<${FolderStep} draft=${draft} />` : null}
    ${step === 2 ? html`<${RepoStep} draft=${draft} />` : null}
    ${step === 3 ? html`<${IgnoreStep} draft=${draft} />` : null}
    ${step === 4 ? html`<${ReviewStep} draft=${draft} />` : null}
    <div class="wizard-foot">
      ${step > 1
        ? html`<${Button} variant="ghost" icon="back" onClick=${() => gotoStep(step - 1)}>Back</${Button}>`
        : html`<${Button} variant="ghost" onClick=${closeEditor}>Cancel</${Button}>`}
      <span class="spacer" />
      ${step < 4
        ? html`<${Button} onClick=${() => gotoStep(step + 1)} disabled=${!canContinue} trailingIcon="chevronRight">Next</${Button}>`
        : html`<${Button} variant="ok" icon="check" onClick=${saveMapping}>Save mapping</${Button}>`}
    </div>
  </div>`;
}
