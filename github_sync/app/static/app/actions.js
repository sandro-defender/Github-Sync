/**
 * All async flows of the panel (network + state transitions).
 *
 * Views stay declarative: they render signals and call these actions, so the
 * behaviour of Check / Upload / Download / Update is defined exactly once.
 * Anything destructive goes through `confirm.value` first and every long job
 * reports progress through the busy overlay.
 */
import { api, isRejected, progressSnapshot } from "./api.js";
import { count, directionLabel } from "./format.js";
import {
  authSetup,
  branches,
  browser,
  busy,
  canSelfUpdate,
  clearUpdateDismissal,
  confirm,
  devicePopup,
  diff,
  dismissUpdate as hideUpdateBanner,
  editor,
  error,
  ignoreSide,
  loading,
  mappings,
  presets,
  pushToast,
  repos,
  resetAccountState,
  sideBySide,
  status,
  tree,
  treeDownload,
  treeExpanded,
  treeQuery,
  treeUpload,
  updating,
  updates,
  userMenuOpen,
  view,
} from "./state.js";

const LOCAL = "local files";

/** Small delay helper. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a job behind the busy overlay while polling `api/progress`.
 *
 * `fn` performs the request; the overlay shows the shortest meaningful
 * message available (job progress beats the static label).
 */
export async function run(label, fn) {
  busy.value = { label, message: label };
  error.value = null;
  const timer = setInterval(async () => {
    try {
      const snapshot = await progressSnapshot();
      const job = snapshot.latest;
      if (!job) return;
      const current = busy.value || {};
      busy.value = {
        ...current,
        message: job.message || label,
        current: job.current,
        total: job.total,
      };
    } catch (_err) {
      /* progress is best effort */
    }
  }, 700);
  try {
    const result = await fn();
    return result;
  } catch (err) {
    const message = err?.message || String(err);
    error.value = message;
    pushToast(message, "error");
    throw err;
  } finally {
    clearInterval(timer);
    busy.value = null;
  }
}

/** Load status, mappings, presets and update info in parallel. */
export async function refresh() {
  loading.value = true;
  const problems = [];
  const grab = async (path, fallback) => {
    try {
      return await api(path);
    } catch (err) {
      problems.push(err.message || String(err));
      return fallback;
    }
  };
  const results = await Promise.all([
    grab("api/status", null),
    grab("api/mappings", { mappings: [] }),
    grab("api/presets", { presets: {} }),
    grab("api/updates", {}),
  ]);
  const [nextStatus, nextMappings, nextPresets, nextUpdates] = results;
  if (nextStatus) status.value = nextStatus;
  mappings.value = nextMappings.mappings || [];
  presets.value = nextPresets.presets || {};
  updates.value = nextUpdates || {};
  if (!nextStatus) {
    error.value = problems[0] || "The app API is not reachable yet.";
  } else {
    error.value = null;
  }
  loading.value = false;
}

/* ------------------------------------------------------------------ wizard */

/** Draft editor state for a new or existing mapping. */
export function blankEditor(existing) {
  const defaults = status.value?.defaults || {};
  return {
    id: existing?.id || "",
    name: existing?.name || "",
    local_path: existing?.local_path || "",
    repository: existing?.repository || "",
    branch: existing?.branch || "main",
    repo_path: existing?.repo_path || "",
    ignore_upload: existing?.ignore_upload ?? defaults.ignore_upload ?? "",
    ignore_download: existing?.ignore_download ?? defaults.ignore_download ?? "",
    commit_message: existing?.commit_message || "",
    auto_sync: Boolean(existing?.auto_sync),
    auto_interval_minutes: existing?.auto_interval_minutes || 60,
    auto_direction: existing?.auto_direction || "upload",
    step: 1,
  };
}

/** Patch the current editor draft. */
export function patchEditor(patch) {
  editor.value = { ...(editor.value || blankEditor()), ...patch };
}

/** Reset the file explorer (folder or rules changed, nothing is loaded). */
export function resetExplorer() {
  tree.value = null;
  treeUpload.value = null;
  treeDownload.value = null;
  treeExpanded.value = [];
  treeQuery.value = "";
}

/** Open the wizard for a new mapping. */
export function startNewMapping() {
  editor.value = blankEditor();
  browser.value = null;
  resetExplorer();
  view.value = "editor";
}

/** Open the wizard for an existing mapping. */
export function editMapping(mapping) {
  editor.value = blankEditor(mapping);
  browser.value = null;
  resetExplorer();
  view.value = "editor";
}

/** Leave the wizard. */
export function closeEditor() {
  editor.value = null;
  browser.value = null;
  diff.value = null;
  resetExplorer();
  view.value = "list";
}

/** Move to a wizard step; loads repositories / previews as needed. */
export function gotoStep(step) {
  patchEditor({ step });
  if (step === 2) loadRepos();
  if (step === 3) refreshExplorer();
}

/** Browse a folder inside the mounted Home Assistant roots. */
export async function browse(path = "") {
  try {
    browser.value = await run("Opening folder…", () => api(`api/browse?path=${encodeURIComponent(path || "")}`));
  } catch (_err) {
    /* error already surfaced */
  }
}

/** Select the currently browsed folder as the mapping source. */
export function pickFolder(path) {
  const target = path === undefined ? browser.value?.path || "" : path;
  patchEditor({ local_path: target, name: (editor.value?.name || target || "").trim() });
  browser.value = null;
  // The explorer shows the *mapped* folder, so a new folder means a new tree.
  resetExplorer();
}

/** Load the repository list (once per account). */
export async function loadRepos() {
  if (repos.value) return;
  try {
    const data = await run("Loading repositories…", () => api("api/repos"));
    repos.value = data.repos || [];
  } catch (_err) {
    repos.value = [];
  }
}

/** Select a repository and load its branches. */
export async function pickRepo(fullName, defaultBranch) {
  patchEditor({ repository: fullName, branch: editor.value?.branch || defaultBranch || "main" });
  try {
    const data = await api(`api/branches?repository=${encodeURIComponent(fullName)}`);
    branches.value = data.branches || [];
  } catch (_err) {
    branches.value = defaultBranch ? [defaultBranch] : ["main"];
  }
}

/** Switch the ignore editor between the upload and download rule sets. */
export function setIgnoreSide(side) {
  if (ignoreSide.value === side) return;
  ignoreSide.value = side;
  // Which folders are open stays the same, but everything else is side-specific.
  tree.value = side === "download" ? treeDownload.value : treeUpload.value;
  refreshExplorer({ side });
}

/** Current ignore field name for the active side. */
export function ignoreField(side = ignoreSide.value) {
  return side === "download" ? "ignore_download" : "ignore_upload";
}

/** Add a preset pattern block to the active ignore side. */
export function applyPreset(key, side = ignoreSide.value) {
  const preset = presets.value?.[key];
  const draft = editor.value;
  if (!preset || !draft) return;
  const field = ignoreField(side);
  const current = draft[field] || "";
  if (current.includes(preset.patterns.trim())) return;
  patchEditor({ [field]: `${current.trim()}\n# ${preset.label}\n${preset.patterns}`.trim() + "\n" });
  refreshExplorer({ side });
}

/**
 * Comment that opens the block of rules the file explorer owns.
 *
 * Everything above it is the user's own gitignore text and is never rewritten:
 * the checkboxes only edit the lines below the marker. gitignore lets the *last*
 * matching rule win, so a tick here always beats a rule above it, deleting the
 * block (or pressing **Reset selection**) restores exactly what the user wrote,
 * and no tick can lose a hand-written rule.
 */
const EXPLORER_BLOCK = "# GitHub Sync selection — the file explorer edits the lines below";

/** `*` and `!**` are the two catch-alls the explorer writes for a whole side. */
const EXCLUDE_ALL = "*";
const REINCLUDE_ALL = "!**";

/** A line with a glob metacharacter is a human pattern, never ours to rewrite. */
const GLOB_CHARS = /[*?[\]]/;

/** Folder levels "Expand all" opens below what is already on screen. */
export const EXPAND_ALL_DEPTH = 3;

/** Debounce for rule typing / the explorer's filter box (ms). */
const EXPLORER_DEBOUNCE = 240;

/** Entries one folder level shows per page (mirrors `paths.TREE_PAGE_SIZE`). */
const EXPLORER_PAGE_SIZE = 200;

let explorerTimer = null;
let explorerSeq = 0;

/**
 * Drop a scheduled re-scan.
 *
 * A pending debounce belongs to the keystroke (or the draft) that queued it:
 * when another mapping takes over the editor, scanning the folder that was
 * open a moment ago would drop the wrong tree into the new draft.
 */
function cancelScheduledExplorerRefresh() {
  if (explorerTimer) {
    clearTimeout(explorerTimer);
    explorerTimer = null;
  }
}

/**
 * Read a rule line the way the explorer does.
 *
 * Returns `{negated, path}` for a plain path rule (`esphome/a.yaml`, `/logs/`,
 * `!/logs/**` — the shapes the explorer writes) and `null` for comments, blank
 * lines and anything with a glob, which the explorer never touches.
 */
function parseRule(line) {
  let text = String(line || "").trim();
  if (!text || text.startsWith("#")) return null;
  const negated = text.startsWith("!");
  if (negated) text = text.slice(1);
  if (text.endsWith("/**")) text = text.slice(0, -3);
  else if (text.endsWith("/")) text = text.slice(0, -1);
  text = text.replace(/^\/+/, "");
  if (!text || GLOB_CHARS.test(text)) return null;
  return { negated, path: text };
}

/** Split the ignore text into the user's own rules and the explorer's block. */
function splitRules(text) {
  const lines = String(text || "").split("\n");
  const at = lines.findIndex((line) => line.trim() === EXPLORER_BLOCK);
  if (at === -1) return { own: lines, block: [] };
  const block = lines
    .slice(at + 1)
    .map((line) => line.trim())
    .filter((line) => line && line !== EXPLORER_BLOCK);
  return { own: lines.slice(0, at), block };
}

/** Rebuild ignore text from `{own, block}` (the marker only exists if needed). */
function joinRules(own, block) {
  const head = (own || []).join("\n").replace(/\s+$/, "");
  const lines = (block || []).map((line) => String(line).trim()).filter(Boolean);
  if (!lines.length) return head ? `${head}\n` : "";
  return `${head ? `${head}\n` : ""}${EXPLORER_BLOCK}\n${lines.join("\n")}\n`;
}

/** `true` when a rule line names `path` itself, or anything below it. */
function namesPath(line, path, { inside = false } = {}) {
  const rule = parseRule(line);
  if (!rule) return false;
  return inside ? rule.path === path || rule.path.startsWith(`${path}/`) : rule.path === path;
}

/**
 * Negation chain that re-includes one path when a broader rule ignores it.
 *
 * Gitignore cannot re-include a file while one of its parent folders stays
 * ignored, so the chain negates every ancestor first (`!/a/`, `!/a/b/`) and
 * ends with the path itself (`!/a/b/c.yaml`). Anchored with a leading `/` so
 * only this one path is affected.
 */
function includeChain(path) {
  const parts = String(path).split("/").filter(Boolean);
  const chain = [];
  for (let index = 1; index <= parts.length; index += 1) {
    const partial = parts.slice(0, index).join("/");
    chain.push(index === parts.length ? `!/${partial}` : `!/${partial}/`);
  }
  return chain;
}

/**
 * Is a `!` re-include line needed to make this row included?
 *
 * The explorer knows two things from its own scan: whether the row is ignored
 * right now (`ignored`) and *which rule* did it (`pattern`). A pattern that is
 * an exact line naming this very path is a line the explorer wrote itself, so
 * deleting it is enough and no noise is added. Anything else — a preset glob
 * like `*.log`, the `*` from "Uncheck all", an ignored parent folder — stays in
 * the user's text and has to be outvoted by writing the chain after it. When in
 * doubt the chain is written: a redundant `!` line is noise, a missing one is a
 * checkbox that does nothing.
 */
function needsReincludeChain(entry, path, block) {
  if (!entry) return true;
  const clean = String(path || "").trim().replace(/^\/+|\/+$/g, "");
  if (!entry.ignored) {
    // The folder itself is fine but files inside it are not: the chain is what
    // turns a half-ticked folder into a fully ticked one.
    return Boolean(entry.is_dir) && (Number(entry.excluded) > 0 || Number(entry.ignored_dirs) > 0);
  }
  const rule = parseRule(entry.pattern || "");
  if (!rule) return true; // a glob or the bare catch-all — never ours to delete
  if (rule.path !== clean) return true; // another path (an ancestor) covers it
  return !block.some((line) => {
    const ours = parseRule(line);
    return Boolean(ours) && !ours.negated && ours.path === clean;
  });
}

/**
 * Re-include chain for a folder: every ancestor, the folder itself, and
 * `**` for everything below it (gitignore needs the parent chain before a
 * child can be re-included at all).
 */
function folderChain(path) {
  const parts = String(path).split("/").filter(Boolean);
  const chain = parts.slice(0, -1).map((_part, index) => `!/${parts.slice(0, index + 1).join("/")}/`);
  const full = parts.join("/");
  return [...chain, `!/${full}/`, `!/${full}/**`];
}

/** `true` when a rule in the block re-includes an ancestor of `path` (e.g. `!**` or `!/parent/**`). */
function hasAncestorReinclude(block, path) {
  if (block.includes(REINCLUDE_ALL)) return true;
  const clean = String(path || "").trim().replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join("/");
    if (i < parts.length && (block.includes(`!/${prefix}/**`) || block.includes(`!${prefix}/**`))) {
      return true;
    }
  }
  return false;
}

/** `true` when the block only ever *re-included* this path, so deleting that is enough. */
function onlyReincluded(block, matches) {
  const negated = block.some((line) => matches(line) && parseRule(line)?.negated);
  const excluded = block.some((line) => matches(line) && !parseRule(line)?.negated);
  return negated && !excluded;
}

/**
 * Pure rule-text transform for one file row.
 *
 * Ticking and unticking are exact mirrors of each other, so a round trip
 * returns the ignore text to what it was.
 */
function applyPathToggle(text, path, included, entry = null) {
  const { own, block } = splitRules(text);
  const clean = String(path || "").trim().replace(/^\/+|\/+$/g, "");
  const matches = (line) => namesPath(line, clean);
  const kept = block.filter((line) => !matches(line));
  if (included) {
    if (!needsReincludeChain(entry, clean, block) || kept.includes(REINCLUDE_ALL)) return joinRules(own, kept);
    const chain = includeChain(clean).filter((line) => !kept.includes(line) && !own.includes(line.trim()));
    return joinRules(own, [...kept, ...chain]);
  }
  // Unticking path:
  // If an ancestor re-includes this path (e.g. !/parent/** or !**), we must explicitly exclude it.
  if (hasAncestorReinclude(kept, clean)) {
    return joinRules(own, [...kept, clean]);
  }
  // Under EXCLUDE_ALL (*), removing re-includes deselects under catch-all.
  if (block.includes(EXCLUDE_ALL)) return joinRules(own, kept);
  // If the path was only re-included in the explorer block, dropping that re-include line is enough.
  if (onlyReincluded(block, matches)) return joinRules(own, kept);
  return joinRules(own, [...kept, clean]);
}

/**
 * Pure rule-text transform for one folder row — a folder rule, never a line
 * per file.
 *
 * Unchecking writes `/folder/`: gitignore ignores everything below an ignored
 * folder, so one line covers all 4 000 files, including the ones the explorer
 * never listed. Ticking it removes that line and — when something broader still
 * ignores the folder or its contents — writes `!/folder/` + `!/folder/**`,
 * which pulls every file inside back in. That is why a folder checkbox costs
 * the same for a huge folder as for a small one and never depends on how many
 * rows were loaded.
 */
function applyFolderToggle(text, folder, included, entry = null) {
  const { own, block } = splitRules(text);
  const clean = String(folder || "").trim().replace(/^\/+|\/+$/g, "");
  const matches = (line) => namesPath(line, clean, { inside: true });
  const kept = block.filter((line) => !matches(line));
  if (included) {
    if (!needsReincludeChain({ ...entry, is_dir: true }, clean, block) || kept.includes(REINCLUDE_ALL)) {
      return joinRules(own, kept);
    }
    const chain = folderChain(clean).filter((line) => !kept.includes(line) && !own.includes(line.trim()));
    return joinRules(own, [...kept, ...chain]);
  }
  // Unticking folder:
  // If an ancestor re-includes this folder (e.g. !/parent/** or !**), we must explicitly exclude it.
  if (hasAncestorReinclude(kept, clean)) {
    return joinRules(own, [...kept, `/${clean}/`]);
  }
  // Under EXCLUDE_ALL (*), removing re-includes deselects under catch-all.
  if (block.includes(EXCLUDE_ALL)) return joinRules(own, kept);
  return joinRules(own, [...kept, `/${clean}/`]);
}

/* ----------------------------------------------------- explorer data flows */

/**
 * Folder levels the explorer needs: the root plus every open folder, each at
 * the window it currently shows (so a keystroke does not collapse a folder
 * that was paged open) — and one page of headroom for "Show more".
 */
function explorerLevels(overrides = {}, targetTree = null) {
  const loaded = (targetTree && targetTree.levels) || (tree.value && tree.value.levels) || {};
  const paths = ["", ...(treeExpanded.value || [])].filter(
    (path, index, all) => all.indexOf(path) === index
  );
  return paths.map((path) => {
    const page = overrides[path] || {};
    const shown = loaded[path] ? (loaded[path].entries || []).length : 0;
    const offset = Number(page.offset) || 0;
    return {
      path,
      offset,
      size: Number(page.size) || (offset ? EXPLORER_PAGE_SIZE : Math.max(EXPLORER_PAGE_SIZE, shown)),
    };
  });
}

/** Load one side of the file explorer. */
async function refreshExplorerSide(side, options = {}) {
  const draft = editor.value;
  if (!draft?.local_path) return;
  const field = ignoreField(side);
  const targetSignal = side === "download" ? treeDownload : treeUpload;
  const previous = targetSignal.value || (ignoreSide.value === side ? tree.value : null) || {};
  const request = ++explorerSeq;
  const levels = explorerLevels(options.pages, previous);
  const query = String(treeQuery.value || "").trim();
  targetSignal.value = { ...previous, loading: true, error: null };
  if (ignoreSide.value === side || !tree.value) {
    tree.value = targetSignal.value;
  }
  try {
    const data = await api("api/preview_tree", {
      method: "POST",
      body: {
        local_path: draft.local_path,
        ignore: draft[field] || "",
        direction: side,
        query,
        depth: options.depth || 0,
        levels,
      },
    });
    if (request !== explorerSeq && options.side !== "both" && !sideBySide.value) return;
    const fresh = { ...data.levels };
    // `append` is a *path*, and the mapping folder's path is the empty string,
    // so the check has to be against null and not for truthiness.
    if (options.append != null && fresh[options.append] && previous.levels?.[options.append]) {
      const before = previous.levels[options.append].entries || [];
      fresh[options.append] = {
        ...fresh[options.append],
        entries: [...before, ...(fresh[options.append].entries || [])],
      };
    }
    const result = { ...data, levels: fresh, loading: false, error: null };
    targetSignal.value = result;
    if (ignoreSide.value === side || !tree.value) {
      tree.value = result;
    }
    if (options.expandFromResponse) {
      treeExpanded.value = Object.keys(fresh).filter((path) => path);
    }
    return result;
  } catch (err) {
    const errResult = { ...previous, loading: false, error: err?.message || String(err) };
    targetSignal.value = errResult;
    if (ignoreSide.value === side || !tree.value) {
      tree.value = errResult;
    }
  }
}

/**
 * Load the file explorer (folder tree + counts).
 *
 * In widescreen two-window view, both upload and download are fetched;
 * otherwise the active side is fetched.
 */
export async function refreshExplorer(options = {}) {
  const draft = editor.value;
  if (!draft?.local_path) return;
  const targetSide = options.side || (sideBySide.value ? "both" : ignoreSide.value);
  if (targetSide === "both") {
    await Promise.all([
      refreshExplorerSide("upload", options),
      refreshExplorerSide("download", options),
    ]);
    return;
  }
  await refreshExplorerSide(targetSide, options);
}

/** Reload the explorer a moment after the last keystroke. */
export function scheduleExplorerRefresh(side, delay = EXPLORER_DEBOUNCE) {
  if (explorerTimer) clearTimeout(explorerTimer);
  explorerTimer = setTimeout(() => {
    explorerTimer = null;
    refreshExplorer({ side: typeof side === "string" ? side : undefined });
  }, delay);
}

/** Filter the explorer (the whole folder is searched, not just what is open). */
export function setExplorerQuery(value) {
  treeQuery.value = value;
  scheduleExplorerRefresh();
}

/** Open or close one folder in the tree; the first open loads its children. */
export function toggleTreeFolder(path, side = ignoreSide.value) {
  if (!path) return;
  const open = (treeExpanded.value || []).includes(path);
  treeExpanded.value = open
    ? (treeExpanded.value || []).filter((item) => item !== path)
    : [...(treeExpanded.value || []), path];
  if (open) return; // collapsing needs no data, the rows are already known
  const currentTree = side === "download" ? treeDownload.value : treeUpload.value;
  if (currentTree?.levels?.[path] || tree.value?.levels?.[path]) return; // already loaded (e.g. after Expand all)
  refreshExplorer({ side });
}

/** Open every folder the scan can reach below what is already visible. */
export function expandAllFolders(side = ignoreSide.value) {
  return refreshExplorer({ depth: EXPAND_ALL_DEPTH, expandFromResponse: true, side });
}

/** Close every folder again. */
export function collapseAllFolders(side = ignoreSide.value) {
  treeExpanded.value = [];
  return refreshExplorer({ side });
}

/** Load the next page of one folder's children (huge folders stay reachable). */
export function showMoreInFolder(path, side = ignoreSide.value) {
  const currentTree = side === "download" ? treeDownload.value : (treeUpload.value || tree.value);
  const level = currentTree?.levels?.[path];
  return refreshExplorer({
    pages: { [path]: { offset: level ? (level.entries || []).length : 0 } },
    append: path,
    side,
  });
}

/* ------------------------------------------------------ explorer checkboxes */

/** Toggle one file row in the file explorer. */
export function toggleIgnoredPath(path, included, entry = null, side = ignoreSide.value) {
  const draft = editor.value;
  if (!draft || !path) return;
  const field = ignoreField(side);
  const next = applyPathToggle(draft[field] || "", path, included, entry);
  if (next === (draft[field] || "")) {
    refreshExplorer({ side });
    return;
  }
  patchEditor({ [field]: next });
  refreshExplorer({ side });
}

/** Toggle one folder row (and with it everything inside, listed or not). */
export function toggleIgnoredFolder(path, included, entry = null, side = ignoreSide.value) {
  const draft = editor.value;
  if (!draft || !path) return;
  const field = ignoreField(side);
  const next = applyFolderToggle(draft[field] || "", path, included, entry);
  if (next === (draft[field] || "")) {
    refreshExplorer({ side });
    return;
  }
  patchEditor({ [field]: next });
  refreshExplorer({ side });
}

/**
 * "Uncheck all" / "Check all" — one catch-all line for the whole side.
 *
 * Both replace the explorer block with a single rule, so the cost is the same
 * for five files as for five thousand, and the button always does what it says
 * (it used to be disabled unless *every* row was already checked, which in a
 * real Home Assistant folder never happens, so it looked dead). The user's own
 * rules stay in the text above the block; deleting the `*` / `!**` line — or
 * pressing **Reset selection** — falls back on them.
 */
export function setAllPaths(included, side = ignoreSide.value) {
  const draft = editor.value;
  if (!draft) return;
  const field = ignoreField(side);
  const { own, block } = splitRules(draft[field] || "");
  const marker = included ? REINCLUDE_ALL : EXCLUDE_ALL;
  if (block.length === 1 && block[0] === marker) {
    pushToast(included ? "Everything is already checked" : "Everything is already unchecked", "info");
    return;
  }
  patchEditor({ [field]: joinRules(own, [marker]) });
  pushToast(
    included
      ? `All ${side === "download" ? "download" : "upload"} files checked — your own rules above are overridden by !**`
      : `All ${side === "download" ? "download" : "upload"} files unchecked — tick the folders or files you want to sync`,
    "success"
  );
  refreshExplorer({ side });
}

/** "Uncheck all": ignore everything on this side, then tick what to keep. */
export function uncheckAllPaths(side = ignoreSide.value) {
  return setAllPaths(false, side);
}

/** "Check all": include everything on this side again. */
export function checkAllPaths(side = ignoreSide.value) {
  return setAllPaths(true, side);
}

/** Drop every rule the explorer wrote; the user's own rules are untouched. */
export function resetExplorerRules(side = ignoreSide.value) {
  const draft = editor.value;
  if (!draft) return;
  const field = ignoreField(side);
  const { own, block } = splitRules(draft[field] || "");
  if (!block.length) {
    pushToast("The explorer has not written any rules on this side", "info");
    return;
  }
  patchEditor({ [field]: joinRules(own, []) });
  pushToast("Selection cleared — your own rules are unchanged", "success");
  refreshExplorer({ side });
}

/** Persist the wizard draft. */
export async function saveMapping() {
  const draft = editor.value;
  if (!draft?.local_path || !draft?.repository) {
    error.value = "Choose a folder and a GitHub repository first.";
    return;
  }
  try {
    await run("Saving mapping…", () =>
      api("api/mappings", {
        method: "POST",
        body: {
          id: draft.id || undefined,
          name: draft.name,
          local_path: draft.local_path,
          repository: draft.repository,
          branch: draft.branch,
          repo_path: draft.repo_path,
          ignore_upload: draft.ignore_upload,
          ignore_download: draft.ignore_download,
          commit_message: draft.commit_message || undefined,
          auto_sync: Boolean(draft.auto_sync),
          auto_interval_minutes: Number(draft.auto_interval_minutes) || 60,
          auto_direction: draft.auto_direction || "upload",
        },
      })
    );
    pushToast("Mapping saved", "success");
    editor.value = null;
    browser.value = null;
    resetExplorer();
    view.value = "list";
    await refresh();
  } catch (_err) {
    /* the banner + toast carry the message */
  }
}

/** Remove a mapping (repository and local files stay untouched). */
export function removeMapping(mapping) {
  confirm.value = {
    title: "Remove this folder sync?",
    body: `“${mapping.name || mapping.local_path}” will stop syncing. The GitHub repository and the local folder are not touched.`,
    ok: "Remove mapping",
    danger: true,
    next: { type: "delete", id: mapping.id },
  };
}

/* ------------------------------------------------------------------- sync */

/** Compare local files with the mapped repository. */
export async function checkMapping(id) {
  try {
    diff.value = await run("Comparing with GitHub…", () =>
      api("api/check", { method: "POST", body: { mapping_id: id } })
    );
    view.value = "diff";
  } catch (_err) {
    /* stored in `error` */
  }
}

/** Ask for confirmation before an upload (with dry-run preview on offer). */
export function askUpload(mapping, mappingId) {
  confirm.value = {
    title: "Upload to GitHub?",
    body: `Upload replaces the mapped repository folder for “${mapping?.name || mapping?.local_path || "this mapping"}”. Remote files that are not in the upload — including files ignored locally — are deleted. Preview first to see the exact plan.`,
    ok: "Upload now",
    next: { type: "upload", id: mappingId ?? mapping?.id },
  };
}

/** Ask for confirmation before a download (extras kept unless opted in). */
export function askDownload(mapping, mappingId) {
  confirm.value = {
    title: "Download from GitHub?",
    body: `Remote files overwrite matching local files for “${mapping?.name || mapping?.local_path || "this mapping"}”. Extra local files are kept unless you tick the cleanup option below.`,
    ok: "Download now",
    delete_extras: false,
    next: { type: "download", id: mappingId ?? mapping?.id },
  };
}

/**
 * Run `POST api/upload` / `api/download` strictly as a read-only preview.
 *
 * Dry runs never mutate GitHub, the filesystem or `/data`, so read-only
 * connections may preview an upload without gaining write access.
 */
export async function previewSync() {
  const pending = confirm.value;
  const type = pending?.next?.type;
  if (!["upload", "download"].includes(type)) return;
  const id = pending.next.id;
  const deleteExtras = Boolean(pending.delete_extras);
  confirm.value = null;
  try {
    diff.value = await run(`Building a ${type} preview (no writes)…`, () =>
      api(`api/${type}`, {
        method: "POST",
        body: { mapping_id: id, dry_run: true, delete_extras: deleteExtras },
      })
    );
    view.value = "diff";
  } catch (_err) {
    /* no sync was performed */
  }
}

/** Execute the confirmed operation. */
export async function confirmOk() {
  const pending = confirm.value;
  confirm.value = null;
  if (!pending?.next) return;
  const { type, id } = pending.next;
  try {
    if (type === "updateApp") {
      await updateAppNow(pending.next.from);
      return;
    }
    if (type === "delete") {
      await run("Removing mapping…", () => api(`api/mappings/${id}`, { method: "DELETE" }));
      pushToast("Mapping removed", "success");
      await refresh();
      return;
    }
    if (type === "upload") {
      const result = await run("Uploading to GitHub…", () =>
        api("api/upload", { method: "POST", body: { mapping_id: id } })
      );
      pushToast(`Uploaded ${count(result.uploaded, "file")}`, "success");
      await refresh();
      return;
    }
    if (type === "download") {
      const result = await run("Downloading from GitHub…", () =>
        api("api/download", {
          method: "POST",
          body: { mapping_id: id, delete_extras: Boolean(pending.delete_extras) },
        })
      );
      const removed = result.deleted ? `, removed ${count(result.deleted, "extra file")}` : "";
      pushToast(`Downloaded ${count(result.downloaded, "file")}${removed}`, "success");
      await refresh();
    }
  } catch (_err) {
    /* the banner + toast carry the message */
  }
}

/** Close the diff view and go back to the mapping list. */
export function closeDiff() {
  diff.value = null;
  view.value = "list";
}

/** Show the dry-run diff for an auto-sync denial etc. */
export function showDiff(result) {
  diff.value = result;
  view.value = "diff";
}

/* -------------------------------------------------------------- GitHub auth */

/** Open the access dialog; `editing` keeps the current connection. */
export function openAuthSetup(editing = false) {
  const access = status.value?.access;
  userMenuOpen.value = false;
  error.value = null;
  authSetup.value = {
    editing,
    mode: access?.mode || "read",
    scope: status.value?.requested_scope || "public_read",
    repositories: (access?.repositories || []).join("\n"),
  };
}

/** Access policy selected in the dialog (frozen into the authorization flow). */
export function selectedAccess() {
  const draft = authSetup.value || {};
  return {
    mode: draft.mode || "read",
    repositories: String(draft.repositories || "")
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

/** Save narrower access limits for the existing connection. */
export async function saveAccess() {
  try {
    status.value = await run("Saving access limits…", () =>
      api("api/access", { method: "POST", body: selectedAccess() })
    );
    authSetup.value = null;
    resetAccountState();
    await refresh();
    pushToast("GitHub access limits saved", "success");
  } catch (_err) {
    /* stored in `error` */
  }
}

/**
 * Connect with a fine-grained token.
 *
 * The token is read from the DOM and never stored in component state, so it
 * cannot leak through a re-render, the devtools state or a bug report.
 */
export async function connectToken() {
  const field = typeof document === "undefined" ? null : document.getElementById("github-token");
  const token = field?.value || "";
  if (field) field.value = "";
  try {
    await run("Connecting to GitHub…", () =>
      api("api/token", { method: "POST", body: { token, access: selectedAccess() } })
    );
    authSetup.value = null;
    resetAccountState();
    await refresh();
    pushToast("Connected to GitHub", "success");
  } catch (_err) {
    /* deliberately keep the secret out of state */
  }
}

/** Start the device flow with the selected scope + access policy. */
export async function startDeviceAuth() {
  if (devicePopup.value || !authSetup.value) return;
  const options = { scope: authSetup.value.scope, access: selectedAccess() };
  try {
    const device = await run("Starting GitHub authorization…", () =>
      api("api/oauth/device/start", { method: "POST", body: options })
    );
    authSetup.value = null;
    devicePopup.value = { ...device, status: "pending", copied: false, error: null };
    const copied = await copyTextToClipboard(device.user_code);
    if (devicePopup.value && devicePopup.value.flow_id === device.flow_id) {
      devicePopup.value = { ...devicePopup.value, copied };
    }
    pollDeviceAuth(device.flow_id, (device.interval || 5) * 1000);
  } catch (_err) {
    /* stored in `error` */
  }
}

/** Copy the device code (used automatically when the popup opens). */
export async function copyDeviceCode() {
  const popup = devicePopup.value;
  if (!popup?.user_code) return;
  const copied = await copyTextToClipboard(popup.user_code);
  if (copied) {
    devicePopup.value = { ...popup, copied: true };
    pushToast("Code copied to clipboard", "success");
  } else {
    pushToast("Copy the code manually", "warn");
  }
}

/** Poll the device flow until it is approved, denied or expired. */
export async function pollDeviceAuth(flowId, delay) {
  await sleep(delay);
  if (!devicePopup.value || devicePopup.value.flow_id !== flowId) return;
  try {
    const result = await api("api/oauth/device/poll", { method: "POST", body: { flow_id: flowId } });
    if (result.status === "pending") {
      pollDeviceAuth(flowId, Math.max(1000, (result.retry_after || 5) * 1000));
      return;
    }
    devicePopup.value = null;
    resetAccountState();
    pushToast(`GitHub authorized as @${result.account?.username || "user"}`, "success");
    await refresh();
  } catch (err) {
    const popup = devicePopup.value;
    if (!popup || popup.flow_id !== flowId) return;
    devicePopup.value = { ...popup, status: "error", error: err?.message || String(err) };
  }
}

/** Abandon the device flow (nothing was granted yet). */
export async function cancelDeviceAuth() {
  const flowId = devicePopup.value?.flow_id;
  if (flowId) {
    await api(`api/oauth/device/${encodeURIComponent(flowId)}`, { method: "DELETE" }).catch(() => {});
  }
  devicePopup.value = null;
}

/** Disconnect: clears local credentials only (GitHub grants stay). */
export async function logout() {
  try {
    await run("Signing out…", () => api("api/token", { method: "DELETE" }));
    userMenuOpen.value = false;
    resetAccountState();
    pushToast("Signed out of GitHub", "success");
    await refresh();
  } catch (_err) {
    /* stored in `error` */
  }
}

/* ------------------------------------------------------------ app updates */

/** Force an update check. */
export async function checkUpdatesNow() {
  try {
    updates.value = await run("Checking for app updates…", () => api("api/updates/check", { method: "POST" }));
    const up = updates.value || {};
    if (up.error) pushToast("Update check failed — see Settings", "warn");
    else if (up.update_available) pushToast(`Version ${up.latest_version} is available`, "success");
    else pushToast("GitHub Sync is up to date", "success");
  } catch (_err) {
    /* stored in `error` */
  }
}

/** Hide the update banner for this version. */
export function dismissUpdateBanner() {
  hideUpdateBanner(updates.value?.latest_version);
}

/** Ask for confirmation before installing an update. */
export function askUpdate() {
  const up = updates.value || {};
  confirm.value = {
    title: "Update GitHub Sync?",
    body: `Home Assistant installs v${up.latest_version || "the new version"} and restarts this app. The sidebar disconnects for a moment and comes back on its own.`,
    ok: "Update now",
    next: { type: "updateApp", from: up.current_version },
  };
}

/**
 * Trigger the update through Home Assistant and poll until the new version
 * answers. The container restarts, so a cut-off response is expected.
 */
export async function updateAppNow(from) {
  if (!canSelfUpdate.value) {
    pushToast("In-app updates need the Home Assistant Supervisor", "warn");
    return;
  }
  updating.value = true;
  error.value = null;
  try {
    await api("api/updates/install", { method: "POST" });
  } catch (err) {
    if (isRejected(err)) {
      updating.value = false;
      error.value = err.message;
      pushToast(err.message, "error");
      return;
    }
    // The restart often cuts the response short — keep waiting for the app.
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && updating.value) {
    await sleep(3000);
    let data = null;
    try {
      data = await api("api/updates");
    } catch (_err) {
      continue; // still restarting
    }
    if (data?.current_version && data.current_version !== from) {
      clearUpdateDismissal();
      updates.value = data;
      updating.value = false;
      pushToast(`Updated to v${data.current_version}`, "success");
      refresh();
      return;
    }
  }
  if (updating.value) {
    updating.value = false;
    error.value =
      "The app has not confirmed the new version yet. The update may still be running — close and reopen GitHub Sync in a moment.";
  }
}

/* ---------------------------------------------------------------- helpers */

/** Clipboard write with an `execCommand` fallback for older webviews. */
export async function copyTextToClipboard(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (_err) {
      /* fall through to the legacy path */
    }
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return Boolean(ok);
  } catch (_err) {
    return false;
  }
}

/** Short label used by the header and toasts. */
export function mappingLabel(mapping) {
  return mapping?.name || mapping?.local_path || "mapping";
}

/** Human readable target for a dry-run plan. */
export function dryRunTarget(dryRun) {
  return dryRun?.target || (dryRun?.direction === "upload" ? "GitHub" : LOCAL);
}

/** Direction label used in confirmations and toasts. */
export { directionLabel };
