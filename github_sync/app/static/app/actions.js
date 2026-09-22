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
  preview,
  presets,
  pushToast,
  repos,
  resetAccountState,
  status,
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

/** Open the wizard for a new mapping. */
export function startNewMapping() {
  editor.value = blankEditor();
  browser.value = null;
  preview.value = null;
  view.value = "editor";
}

/** Open the wizard for an existing mapping. */
export function editMapping(mapping) {
  editor.value = blankEditor(mapping);
  browser.value = null;
  preview.value = null;
  view.value = "editor";
}

/** Leave the wizard. */
export function closeEditor() {
  editor.value = null;
  browser.value = null;
  diff.value = null;
  view.value = "list";
}

/** Move to a wizard step; loads repositories / previews as needed. */
export function gotoStep(step) {
  patchEditor({ step });
  if (step === 2) loadRepos();
  if (step === 3) refreshIgnorePreview();
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
  preview.value = null;
  refreshIgnorePreview();
}

/** Current ignore field name for the active side. */
export function ignoreField(side = ignoreSide.value) {
  return side === "download" ? "ignore_download" : "ignore_upload";
}

/** Add a preset pattern block to the active ignore side. */
export function applyPreset(key) {
  const preset = presets.value?.[key];
  const draft = editor.value;
  if (!preset || !draft) return;
  const field = ignoreField();
  const current = draft[field] || "";
  if (current.includes(preset.patterns.trim())) return;
  patchEditor({ [field]: `${current.trim()}\n# ${preset.label}\n${preset.patterns}`.trim() + "\n" });
  refreshIgnorePreview();
}

/** Live count of included/ignored files for the active ignore side. */
export async function refreshIgnorePreview() {
  const draft = editor.value;
  if (!draft?.local_path) return;
  const side = ignoreSide.value;
  try {
    preview.value = await api("api/preview_ignore", {
      method: "POST",
      body: {
        local_path: draft.local_path,
        ignore: draft[ignoreField(side)] || "",
        direction: side,
      },
    });
  } catch (err) {
    preview.value = null;
    error.value = err.message || String(err);
  }
}

/**
 * All ignore lines that name a path exactly (anchored or not, folder or not).
 * Used to recognise and remove hand-written or previously added exact rules.
 */
function exactRuleLines(path) {
  return [path, `${path}/`, `/${path}`, `/${path}/`];
}

/** All ignore lines that re-include (`!`) a path exactly. */
function exactNegationLines(path) {
  return [`!${path}`, `!/${path}`, `!${path}/`, `!/${path}/`];
}

/**
 * Negation chain that re-includes one path when a broader rule ignores it.
 *
 * Gitignore cannot re-include a file while one of its parent folders stays
 * ignored, so the chain negates every ancestor first (`!/a/`, `!/a/b/`) and
 * ends with the file itself (`!/a/b/c.yaml`). Anchored with a leading `/` so
 * only this one path is affected.
 */
function includeChain(path) {
  const parts = String(path).split("/").filter(Boolean);
  const chain = [];
  for (let index = 1; index < parts.length; index += 1) {
    chain.push(`!/${parts.slice(0, index).join("/")}/`);
  }
  if (parts.length) chain.push(`!/${parts.join("/")}`);
  return chain;
}

/**
 * Toggle one path in the active ignore rules (a checkbox in the sync preview).
 *
 * `included` is the checkbox's new state:
 *  - unchecking excludes the path — usually by adding an exact rule; when the
 *    path was previously force-included by an auto `!` chain, only its own
 *    negation line is removed (ancestor `!/dir/` lines are left alone: they
 *    are harmless and may belong to other selections or hand-written rules);
 *  - checking includes it again — by removing an exact rule that names the
 *    path, or, when a broader pattern (a preset glob, or the `*` added by
 *    "Uncheck all") is what excludes it, by appending the negation chain so
 *    just this path is re-included.
 */
export function toggleIgnoredPath(path, included) {
  const draft = editor.value;
  if (!draft || !path) return;
  const field = ignoreField();
  const current = draft[field] || "";
  const lines = current.split("\n").map((line) => line.trimEnd());
  const exact = exactRuleLines(path);
  const negations = exactNegationLines(path);
  if (included) {
    if (lines.some((line) => exact.includes(line))) {
      patchEditor({ [field]: lines.filter((line) => !exact.includes(line)).join("\n") });
    } else {
      const chain = includeChain(path).filter((line) => !lines.includes(line));
      if (chain.length) {
        patchEditor({ [field]: `${current.replace(/\s*$/, "")}\n${chain.join("\n")}`.trim() + "\n" });
      }
    }
  } else if (lines.some((line) => negations.includes(line))) {
    patchEditor({ [field]: lines.filter((line) => !negations.includes(line)).join("\n") });
  } else if (!lines.some((line) => exact.includes(line))) {
    patchEditor({ [field]: `${current.replace(/\s*$/, "")}\n${path}`.trim() + "\n" });
  }
  refreshIgnorePreview();
}

/**
 * "Uncheck all" — exclude everything on the active ignore side by appending a
 * single `*` rule. Ticking a checkbox afterwards re-includes just that file
 * via an automatic `!` negation chain (see `toggleIgnoredPath`). Existing
 * rules stay untouched; removing the `*` line by hand restores them.
 */
export function uncheckAllPaths() {
  const draft = editor.value;
  if (!draft) return;
  const field = ignoreField();
  const current = draft[field] || "";
  const lines = current.split("\n").map((line) => line.trim());
  if (lines.includes("*") || lines.includes("**")) {
    pushToast("Everything is already unchecked — tick files to sync them again", "info");
    return;
  }
  patchEditor({ [field]: `${current.replace(/\s*$/, "")}\n*`.trim() + "\n" });
  pushToast("All files unchecked — tick the ones you want to sync", "success");
  refreshIgnorePreview();
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
    resetAccountState();
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
