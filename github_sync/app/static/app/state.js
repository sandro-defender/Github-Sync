/**
 * Application state as signals.
 *
 * Components read `status.value`, `mappings.value`, … and re-render
 * automatically (see `deps.js`). Keeping state in signals instead of one big
 * render function is what makes the UI feel instant: a toast or an inline
 * validation message no longer repaints the whole page.
 *
 * Invariants:
 *   - The GitHub token never enters this state (see `actions.connectToken`).
 *   - Derived UI data (filters, counts) lives in `computed` signals.
 */
import { computed, signal } from "./deps.js";

/** GET api/status payload (`configured`, `version`, `access`, `defaults`, …). */
export const status = signal({ configured: false });
/** GET api/mappings list. */
export const mappings = signal([]);
/** GET api/presets → gitignore preset chips. */
export const presets = signal({});
/** GET api/updates → app self-update snapshot. */
export const updates = signal({});
/** `list` | `editor` | `diff` | `settings`. */
export const view = signal("list");
/** Mapping wizard draft (or `null` outside the editor). */
export const editor = signal(null);
/** Ignore editor side: `upload` | `download`. */
export const ignoreSide = signal("upload");
/**
 * File explorer state for the ignore editor (`api/preview_tree`).
 *
 * `{ root, levels, search, truncated, scanned, loading, error }` where `levels`
 * maps a folder path (`""` is the mapping root) to the page of children the
 * last request returned. Only loaded levels are kept, so expanding a folder is
 * one small request instead of shipping the whole tree.
 */
export const tree = signal(null);
/** File explorer state for the upload side in two-window view. */
export const treeUpload = signal(null);
/** File explorer state for the download side in two-window view. */
export const treeDownload = signal(null);
/** Widescreen two-window mode: show both upload and download brother windows. */
export const sideBySide = signal(
  typeof window !== "undefined" && typeof window.innerWidth === "number" ? window.innerWidth >= 1000 : false
);
/** Folder paths the user opened in the file explorer. */
export const treeExpanded = signal([]);
/** Filter box of the file explorer (searches the whole folder). */
export const treeQuery = signal("");
/** File browser result for the wizard's folder step. */
export const browser = signal(null);
/** Repository list (or `null` before it was loaded). */
export const repos = signal(null);
/** Branches of the selected repository. */
export const branches = signal([]);
/** Repository filter box in the wizard. */
export const repoQuery = signal("");
/** Mapping filter box on the mappings page. */
export const mappingQuery = signal("");
/** Check result shown by the diff view. */
export const diff = signal(null);
/** Client-side filter for the diff table: `all` | `add` | `mod` | `del` | `conflict`. */
export const diffFilter = signal("all");
/** Pending confirmation dialog (`{title, body, ok, danger, next, delete_extras}`). */
export const confirm = signal(null);
/** Access setup dialog draft (`{editing, mode, scope, repositories}`). */
export const authSetup = signal(null);
/** Device-code popup state (`{flow_id, user_code, …}`). */
export const devicePopup = signal(null);
/** Header account dropdown visibility. */
export const userMenuOpen = signal(false);
/** Busy overlay state (`{label, message, current, total}`) or `null`. */
export const busy = signal(null);
/** Global error banner text. */
export const error = signal(null);
/** Toast stack (`{id, message, tone}`). */
export const toasts = signal([]);
/** True while an app self-update is running. */
export const updating = signal(false);
/** True until the first `refresh()` finishes. */
export const loading = signal(true);

export const isConfigured = computed(() => Boolean(status.value?.configured));
export const mappingCount = computed(() => (mappings.value || []).length);
export const version = computed(() => status.value?.version || updates.value?.current_version || "");
export const latestVersion = computed(() => updates.value?.latest_version || "");
export const updateAvailable = computed(() => Boolean(updates.value?.update_available));

/** Update banner visibility, honouring the per-version dismissal. */
export const updateBannerVisible = computed(() => {
  const up = updates.value || {};
  if (!up.update_available || !up.latest_version) return false;
  if (updating.value) return false;
  return dismissedUpdateVersion() !== up.latest_version;
});

/** Suggestions are only verified when they come from the Supervisor. */
export const canSelfUpdate = computed(() => {
  const up = updates.value || {};
  return Boolean(up.update_available && up.source === "supervisor" && !up.error);
});

const DISMISS_KEY = "gsUpdateDismissed";

/** Version the user dismissed the update banner for (persisted in the browser). */
export function dismissedUpdateVersion() {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch (_err) {
    return null;
  }
}

/** Hide the update banner until a newer version shows up. */
export function dismissUpdate(version) {
  try {
    if (version) localStorage.setItem(DISMISS_KEY, version);
  } catch (_err) {
    /* private mode / storage disabled — the banner just stays visible */
  }
  updates.value = { ...(updates.value || {}) };
}

/** Clear a dismissal (used after a successful self-update). */
export function clearUpdateDismissal() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch (_err) {
    /* ignore */
  }
}

let toastSeq = 0;

/** Push a toast; returns its id. */
export function pushToast(message, tone = "info") {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, message, tone }];
  const timers = (pushToast._timers = pushToast._timers || new Map());
  const timer = setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 4200);
  timers.set(id, timer);
  return id;
}

/** Remove a toast by id. */
export function dismissToast(id) {
  const timers = pushToast._timers || new Map();
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.value = toasts.value.filter((item) => item.id !== id);
}

/** Reset account-scoped view state (used on logout and account switch). */
export function resetAccountState() {
  repos.value = null;
  branches.value = [];
  repoQuery.value = "";
  tree.value = null;
  treeUpload.value = null;
  treeDownload.value = null;
  treeExpanded.value = [];
  treeQuery.value = "";
  browser.value = null;
  diff.value = null;
  confirm.value = null;
  authSetup.value = null;
}
