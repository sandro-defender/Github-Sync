/**
 * Frontend regression tests — no browser required.
 *
 * The panel is a Preact app; these tests render it into the DOM stub from
 * `tests/dom_stub.cjs` with a fake `fetch`, so real templates, signals,
 * event handlers and request payloads are exercised in plain Node.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, beforeEach } = require("node:test");

const { createDom, installDom } = require("./dom_stub.cjs");

const APP_DIR = path.join(__dirname, "..", "github_sync", "app", "static", "app");

// Keep the process from hanging on toast (4s) and progress-poll (0.7s) timers,
// while still letting the test's own zero-delay "flush" timers fire.
for (const name of ["setTimeout", "setInterval"]) {
  const real = globalThis[name];
  globalThis[name] = (handler, delay, ...rest) => {
    const timer = real(handler, delay, ...rest);
    if ((Number(delay) || 0) >= 500) timer.unref?.();
    return timer;
  };
}

const STATUS = {
  configured: true,
  username: "sandrod",
  version: "0.3.2",
  auth_method: "device",
  requested_scope: "public_read",
  access: { mode: "write", repositories: ["owner/ha-config"] },
  roots: ["homeassistant", "share"],
  defaults: { ignore_upload: ".storage/\n", ignore_download: "" },
  mapping_count: 1,
};

const MAPPINGS = {
  mappings: [
    {
      id: "m1",
      name: "ESPHome",
      local_path: "homeassistant/esphome",
      repository: "owner/ha-esphome",
      branch: "main",
      repo_path: "",
      ignore_upload: ".storage/\n",
      ignore_download: "",
      commit_message: "chore(ha): sync {name}",
      auto_sync: true,
      auto_interval_minutes: 60,
      auto_direction: "upload",
      last_sync: { direction: "upload", at: new Date().toISOString(), uploaded: 3 },
      last_error: null,
    },
  ],
};

const UPDATES = { current_version: "0.3.2", latest_version: "0.4.0", update_available: true, source: "supervisor", checked_at: new Date().toISOString() };

let dom;
let calls;
let modules;

/** Fresh DOM + fake network for every test. */
async function boot(options = {}) {
  dom = createDom();
  installDom(dom.document);
  calls = [];

  const status = options.status === undefined ? { ...STATUS } : options.status;
  const responses = {
    "api/status": status,
    "api/mappings": options.mappings || MAPPINGS,
    "api/presets": { presets: { ha_secrets: { label: "HA secrets", patterns: ".storage/\nsecrets.yaml" } } },
    "api/updates": options.updates || {},
    "api/progress": { jobs: [], latest: null },
    ...(options.responses || {}),
  };

  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || "GET", body });
    const handler = (options.handlers || {})[url];
    if (handler) {
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(handler(body) || {}) };
    }
    if (options.fail && url.startsWith(options.fail)) {
      return { ok: false, status: 400, statusText: "Bad Request", text: async () => JSON.stringify({ detail: "Something broke" }) };
    }
    if (url === "api/token" && (opts.method || "GET") === "DELETE") {
      status.configured = false;
      status.username = null;
    }
    if (url === "api/token" && (opts.method || "GET") === "POST") {
      status.configured = true;
      status.username = "token-user";
      status.auth_method = "token";
    }
    if (url === "api/mappings" && (opts.method || "GET") === "POST") {
      responses["api/mappings"] = { mappings: [...((responses["api/mappings"] || {}).mappings || []), { ...body, id: "m2" }] };
    }
    const data = responses[url] ?? {};
    return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(data) };
  };

  modules = {
    deps: await import("../github_sync/app/static/app/deps.js"),
    state: await import("../github_sync/app/static/app/state.js"),
    actions: await import("../github_sync/app/static/app/actions.js"),
    ui: await import("../github_sync/app/static/app/ui.js"),
    app: await import("../github_sync/app/static/app/views/app.js"),
  };

  const { state } = modules;
  state.status.value = status || { configured: false };
  state.mappings.value = (options.mappings || MAPPINGS).mappings || [];
  state.updates.value = options.updates || {};
  state.view.value = "list";
  state.editor.value = null;
  state.confirm.value = null;
  state.authSetup.value = null;
  state.devicePopup.value = null;
  state.busy.value = null;
  state.error.value = null;
  state.loading.value = false;
  state.userMenuOpen.value = false;
  state.mappingQuery.value = "";
  state.diff.value = null;

  const { html, render } = modules.deps;
  render(html`<${modules.app.Shell} />`, dom.root);
  await flush();
  return dom.root;
}

/**
 * Let Preact + Signals flush.
 *
 * Signals schedule their re-render in a microtask, so assertions have to yield
 * once after changing state (this is also what keeps the real UI instant).
 */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait for pending signal-driven re-renders to reach the DOM. */
const paint = flush;

/** Let queued promises run without yielding to timers (a `setTimeout` cannot fire). */
async function microtasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

/**
 * Poll `check()` until it passes or `limit` ms elapse.
 *
 * Anything that waits on a *real* timer (the explorer's debounce) has to be
 * polled: a fixed sleep is both slow and flaky, because a loaded CI runner can
 * stall a 240 ms timer for longer than the sleep allowed.
 */
async function waitFor(check, limit = 3000) {
  const deadline = Date.now() + limit;
  for (;;) {
    if (check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/* ------------------------------------------------------- file explorer fake */

/** A file row as `api/preview_tree` returns it. */
const fileEntry = (path, extra = {}) => ({
  name: path.split("/").pop(),
  path,
  is_dir: false,
  size: 10,
  ignored: false,
  pattern: null,
  symlink: false,
  too_large: false,
  ...extra,
});

/** A folder row, including its recursive rollup (all files inside included). */
const dirEntry = (path, extra = {}) => ({
  name: path.split("/").pop(),
  path,
  is_dir: true,
  size: null,
  ignored: false,
  pattern: null,
  symlink: false,
  can_open: true,
  files: 3,
  included: 3,
  excluded: 0,
  dirs: 0,
  ignored_dirs: 0,
  included_size: 30,
  complete: true,
  unknown: false,
  ...extra,
});

/**
 * Fake `api/preview_tree`: answers *only* the levels a request asks about.
 *
 * The real endpoint lists one directory level per requested `levels` entry and
 * pages it, so a test can prove the app asks for a folder when it opens it,
 * asks for the next page when it says "Show more", and never renders children
 * it was not given.
 */
function previewTreeServer({ levels, root = {}, search = null, truncated = false, defaultPageSize = 200 } = {}) {
  const resolve = (value) => (typeof value === "function" ? value() : value);
  const server = (request = {}) => {
    const asked = request.levels?.length ? request.levels : [{ path: "", offset: 0 }];
    const out = {};
    for (const item of asked) {
      const level = levels[item.path];
      if (!level) continue;
      const entries = typeof level === "function" ? level(request) : level.entries || [];
      const total = typeof level === "function" ? entries.length : level.total ?? entries.length;
      const size = Number(item.size) || defaultPageSize;
      const offset = Math.min(Math.max(0, Number(item.offset) || 0), entries.length);
      out[item.path] = {
        path: item.path,
        offset,
        page_size: size,
        total,
        has_more: offset + size < entries.length,
        capped: typeof level === "function" ? false : Boolean(level.capped),
        entries: entries.slice(offset, offset + size),
      };
    }
    const answer = {
      root: resolve(root) || {},
      levels: out,
      truncated: resolve(truncated),
      scanned: 42,
      path: "homeassistant",
      direction: request.direction,
    };
    if (search) answer.search = search(String(request.query || ""));
    return answer;
  };
  server.requests = () => calls.filter((call) => call.url === "api/preview_tree");
  return server;
}

/** Every rendered explorer row, in document order. */
function treeRowsOf(root) {
  return root.querySelectorAll(".tree-row");
}

/** The row whose text contains `needle` (name or path). */
function explorerRow(root, needle) {
  return treeRowsOf(root).find((node) => node.textContent.includes(needle)) || null;
}

/** Find a button/clickable by its visible text. */
function findButton(root, text) {
  const nodes = [...root.querySelectorAll("button"), ...root.querySelectorAll("a")];
  return nodes.find((node) => node.textContent.includes(text)) || null;
}

/** Set an input value and fire the `input` event Preact listens to. */
function type(element, value) {
  element.value = value;
  element.dispatchEvent({ type: "input" });
}

beforeEach(() => {
  /* boot() runs per test; nothing global to reset */
});

test("shell renders mappings, header and the update banner from the API", async () => {
  const root = await boot({ updates: UPDATES });
  await modules.actions.refresh();

  const html = root.innerHTML;
  assert.match(html, /ESPHome/);
  assert.match(html, /owner\/ha-esphome/);
  assert.match(html, /@sandrod/);
  assert.match(html, /v0\.3\.2/);
  assert.match(html, /Version 0\.4\.0 is available/);
  assert.ok(findButton(root, "Update now"), "update banner offers the update");
  assert.ok(findButton(root, "Upload"), "mapping card offers Upload");
  assert.ok(calls.some((call) => call.url === "api/status"));
});

test("access dialog states its limits and freezes the policy into the device flow", async () => {
  const root = await boot();
  await modules.actions.refresh();

  modules.actions.openAuthSetup();
  await paint();
  assert.match(root.innerHTML, /App-side limits only/);
  assert.match(root.innerHTML, /GitHub grants are broader than app limits/);

  modules.state.authSetup.value = { editing: false, mode: "read", scope: "repo", repositories: "owner/repo\n  owner/other  " };
  await paint();
  await modules.actions.startDeviceAuth();

  const start = calls.find((call) => call.url === "api/oauth/device/start");
  assert.deepEqual(start.body, { scope: "repo", access: { mode: "read", repositories: ["owner/repo", "owner/other"] } });
  assert.equal(modules.state.authSetup.value, null, "dialog closes once the flow starts");
});

test("the fine-grained token is read once, cleared, and never kept in UI state", async () => {
  await boot();
  modules.actions.openAuthSetup();
  await paint();

  const field = dom.document.getElementById("github-token");
  assert.ok(field, "token field is rendered");
  field.value = "github_pat_test_only";
  await modules.actions.connectToken();

  assert.equal(field.value, "", "field is cleared after submitting");
  const tokenCall = calls.find((call) => call.url === "api/token");
  assert.equal(tokenCall.body.token, "github_pat_test_only");
  const serialised = JSON.stringify({
    authSetup: modules.state.authSetup.value,
    error: modules.state.error.value,
    status: modules.state.status.value,
  });
  assert.ok(!serialised.includes("github_pat_test_only"), "secret never reaches UI state");
});

test("previews send strict dry-run booleans and never mutate anything", async () => {
  const plan = {
    dry_run: true,
    direction: "download",
    target: "local files",
    repository: "owner/ha-esphome",
    branch: "main",
    actions: [{ path: "esphome/kitchen.yaml", action: "update" }],
    create_count: 0,
    update_count: 1,
    delete_count: 0,
    unchanged: 2,
    skipped: 0,
  };
  const root = await boot({ responses: { "api/download": plan } });
  await modules.actions.refresh();

  const card = findButton(root, "Download");
  card.click();
  modules.state.confirm.value = { ...modules.state.confirm.value, delete_extras: true };
  await modules.actions.previewSync();

  const preview = calls.find((call) => call.url === "api/download");
  assert.deepEqual(preview.body, { mapping_id: "m1", dry_run: true, delete_extras: true });
  assert.equal(modules.state.confirm.value, null, "confirmation closes after previewing");
  assert.equal(calls.filter((call) => call.url.startsWith("api/download")).length, 1, "no real download follows a preview");
  assert.match(root.innerHTML, /Download preview/);
  assert.match(root.innerHTML, /Nothing was written/);
  assert.match(root.innerHTML, /would overwrite/);
});

test("confirmation dialogs only send the options the user picked", async () => {
  await boot();
  await modules.actions.refresh();

  modules.actions.askDownload(modules.state.mappings.value[0]);
  await paint();
  assert.match(dom.root.innerHTML, /Delete local files that are not in GitHub/);
  await modules.actions.confirmOk();
  const download = calls.find((call) => call.url === "api/download");
  assert.deepEqual(download.body, { mapping_id: "m1", delete_extras: false });

  modules.actions.askUpload(modules.state.mappings.value[0]);
  await modules.actions.confirmOk();
  const upload = calls.find((call) => call.url === "api/upload");
  assert.deepEqual(upload.body, { mapping_id: "m1" });
});

test("update failures and fallback releases never claim a verified install", async () => {
  const root = await boot({ updates: { error: "Offline", latest_version: "9.9.9" } });
  modules.state.view.value = "settings";
  await paint();
  assert.match(root.innerHTML, /Could not verify updates/);
  assert.ok(!root.innerHTML.includes("You have the latest version"));

  modules.state.updates.value = { source: "github", update_available: true, latest_version: "9.9.9", current_version: "0.3.2" };
  await paint();
  assert.ok(!root.innerHTML.includes("Update now"), "GitHub fallback never offers a one-click install");
  assert.match(root.innerHTML, /update this app from its install source/i);
});

test("editor wizard walks folder → repo → explorer → review and saves one mapping", async () => {
  const levels = {
    "": { entries: [dirEntry("esphome", { files: 2, included: 2, dirs: 1, included_size: 180 }), fileEntry("ui-lovelace.yaml", { size: 40 })] },
    esphome: { entries: [dirEntry("esphome/living", { files: 1, included: 1, included_size: 60 }), fileEntry("esphome/kitchen.yaml", { size: 120 })] },
    "esphome/living": { entries: [fileEntry("esphome/living/lights.yaml", { size: 60 })] },
  };
  const server = previewTreeServer({
    levels,
    root: { files: 4, included: 4, excluded: 0, dirs: 2, ignored_dirs: 0, included_size: 220, complete: true },
  });
  const root = await boot({
    responses: {
      "api/browse?path=": { path: "", parent: null, root: "Home Assistant", entries: [{ name: "homeassistant", path: "homeassistant", is_dir: true }] },
      "api/repos": { repos: [{ full_name: "owner/ha-esphome", default_branch: "main", private: false, description: "ESPHome config" }] },
      "api/branches?repository=owner%2Fha-esphome": { branches: ["main", "dev"] },
    },
    handlers: { "api/preview_tree": server },
  });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  await paint();
  assert.match(root.innerHTML, /Which Home Assistant folder/);

  await modules.actions.browse("");
  await paint();
  assert.match(root.innerHTML, /homeassistant/);
  modules.actions.pickFolder("homeassistant");
  await paint();
  assert.equal(modules.state.editor.value.local_path, "homeassistant");
  assert.equal(modules.state.tree.value, null, "picking a folder drops the previous explorer scan");

  modules.actions.gotoStep(2);
  await modules.actions.loadRepos();
  await paint();
  assert.match(root.innerHTML, /owner\/ha-esphome/);
  await modules.actions.pickRepo("owner/ha-esphome", "main");
  await paint();
  assert.deepEqual(modules.state.branches.value, ["main", "dev"]);

  // Step 3 is the file explorer: the mapped folder as a tree, tickable at any depth.
  modules.actions.gotoStep(3);
  await paint();
  assert.match(root.innerHTML, /File explorer/, "step 3 shows the file explorer");
  assert.equal(modules.state.tree.value.root.included, 4, "the explorer counted the folder");
  assert.match(explorerRow(root, "esphome").textContent, /2 files/, "folder rows say what is inside");
  assert.equal(explorerRow(root, "esphome").querySelector("input").checked, true, "a fully included folder renders checked");

  explorerRow(root, "esphome").querySelector(".tree-name").click();
  await paint();
  assert.ok(explorerRow(root, "kitchen.yaml"), "clicking a folder opens it");

  // Unticking a file writes the rule into the explorer's own block…
  const box = explorerRow(root, "kitchen.yaml").querySelector("input");
  box.checked = false;
  box.dispatchEvent({ type: "change" });
  await paint();
  assert.match(
    modules.state.editor.value.ignore_upload,
    /# GitHub Sync selection[^\n]*\nesphome\/kitchen\.yaml\n$/,
    "a ticked-off file becomes one exact ignore rule"
  );

  modules.actions.gotoStep(4);
  await paint();
  assert.match(root.innerHTML, /Enable automatic sync/);
  await modules.actions.saveMapping();

  const saved = calls.find((call) => call.url === "api/mappings" && call.method === "POST");
  assert.equal(saved.body.local_path, "homeassistant");
  assert.equal(saved.body.repository, "owner/ha-esphome");
  assert.equal(saved.body.branch, "main");
  assert.equal(
    saved.body.ignore_upload,
    `.storage/\n${"# GitHub Sync selection — the file explorer edits the lines below"}\nesphome/kitchen.yaml\n`,
    "the saved mapping keeps the default rules plus the explorer's own block"
  );
  assert.equal(modules.state.view.value, "list", "wizard returns to the list after saving");
});

test("failing API calls surface an error banner instead of failing silently", async () => {
  const root = await boot({ fail: "api/check" });
  await modules.actions.refresh();
  await modules.actions.checkMapping("m1");
  await paint();
  assert.equal(modules.state.error.value, "Something broke");
  assert.equal(modules.state.diff.value, null, "a failed check shows nothing to sync");
  assert.match(root.innerHTML, /Something broke/);
  assert.ok(modules.state.toasts.value.some((toast) => toast.tone === "error"));
});

test("rendered files are escaped and the app never injects raw HTML", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const root = await boot({
    mappings: {
      mappings: [{ ...MAPPINGS.mappings[0], name: hostile, local_path: `homeassistant/${hostile}` }],
    },
  });
  await modules.actions.refresh();
  await paint();
  assert.ok(!root.innerHTML.includes("<img src=x"), "markup stays text");
  assert.match(root.innerHTML, /&lt;img src=x/);

  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) sources.push(full);
    }
  };
  walk(APP_DIR);
  for (const file of sources) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!/innerHTML\s*=/.test(source), `${path.relative(APP_DIR, file)} must not assign innerHTML`);
    assert.ok(!source.includes("dangerouslySetInnerHTML"), `${path.relative(APP_DIR, file)} must not use dangerouslySetInnerHTML`);
    assert.ok(!source.includes("document.write"), `${path.relative(APP_DIR, file)} must not use document.write`);
  }
});

test("file explorer ticks files into the explorer block and back out again", async () => {
  const levels = {
    "": { entries: [fileEntry("a.yaml"), fileEntry("b.log", { ignored: true, pattern: "*.log" })] },
  };
  const root = await boot({
    handlers: {
      "api/preview_tree": previewTreeServer({ levels, root: { files: 2, included: 1, excluded: 1, dirs: 0 } }),
    },
  });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  modules.state.ignoreSide.value = "upload";
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "*.log\n" });
  modules.actions.gotoStep(3);
  await paint();

  const rules = () => modules.state.editor.value.ignore_upload;
  const toggle = (name, checked) => {
    const row = explorerRow(root, name);
    assert.ok(row, `the explorer renders a row for ${name}`);
    const input = row.querySelector("input");
    input.checked = checked;
    input.dispatchEvent({ type: "change" });
  };

  assert.match(root.innerHTML, /File explorer/, "the wizard step shows the file explorer");
  assert.equal(rules(), "*.log\n", "nothing is written before the user ticks anything");

  // Unticking an included file writes one exact rule — inside the explorer's
  // own block, so the user's `*.log` line above it is never touched.
  toggle("a.yaml", false);
  await paint();
  assert.match(rules(), /# GitHub Sync selection/, "the explorer marks its own rule block");
  assert.match(rules(), /(^|\n)a\.yaml\n/, "unchecking writes the exact path");
  assert.match(rules(), /^\*\.log\n/, "the user's own rules stay on top, unchanged");

  // Ticking it again removes the line, so the text ends up exactly as it was.
  levels[""] = {
    entries: [fileEntry("a.yaml", { ignored: true, pattern: "a.yaml" }), fileEntry("b.log", { ignored: true, pattern: "*.log" })],
  };
  await modules.actions.refreshExplorer();
  await paint();
  assert.ok(explorerRow(root, "a.yaml").classList.contains("unchecked"), "the file row now reads as ignored");
  toggle("a.yaml", true);
  await paint();
  assert.equal(rules(), "*.log\n", "re-checking deletes the rule again, marker and all");

  // A file ignored by a *broader* rule cannot be freed by deleting a line, so
  // ticking it writes an anchored re-include; unticking it again leaves an
  // exact rule (never a change that the next scan could silently undo).
  levels[""] = { entries: [fileEntry("a.yaml"), fileEntry("b.log", { ignored: true, pattern: "*.log" })] };
  await modules.actions.refreshExplorer();
  await paint();
  toggle("b.log", true);
  await paint();
  assert.match(rules(), /(^|\n)!\/b\.log\n/, "ticking a glob-ignored file re-includes it");
  toggle("b.log", false);
  await paint();
  assert.equal(rules(), "*.log\n", "…and unticking removes exactly the line it added");
});

test("file explorer folder rows tick whole folders, however big they are", async () => {
  // `big` holds 4 000 files and was never listed — the app only got the folder
  // row. Ticking it must still cover all of it, in one line.
  const big = () => dirEntry("big", { files: 4000, included: 4000, dirs: 12, included_size: 400000 });
  const mixed = () => dirEntry("mixed", { files: 5, included: 3, excluded: 2 });
  const storage = () =>
    dirEntry(".storage", { ignored: true, pattern: ".storage/", files: 0, included: 0, complete: false, unknown: true });
  const levels = { "": { entries: [big(), mixed(), storage()] } };
  const server = previewTreeServer({
    levels,
    root: { files: 4005, included: 4003, excluded: 2, dirs: 14, ignored_dirs: 0, included_size: 400030, complete: true },
  });
  const root = await boot({ handlers: { "api/preview_tree": server } });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: ".storage/\n*.cache\n" });
  modules.actions.gotoStep(3);
  await paint();

  const rules = () => modules.state.editor.value.ignore_upload;
  const row = (name) => {
    const found = explorerRow(root, name);
    assert.ok(found, `the explorer renders a row for ${name}`);
    return found;
  };
  const toggle = (name, checked) => {
    const input = row(name).querySelector("input");
    input.checked = checked;
    input.dispatchEvent({ type: "change" });
  };

  assert.ok(row("big").classList.contains("folder"), "folders render as folder rows");
  assert.match(row("big").textContent, /4000 files/, "counts come from the folder rollup, not from loaded rows");
  assert.match(row("big").textContent, /12 folders/, "…including nested folders");
  assert.equal(row("big").querySelector("input").checked, true, "a fully included folder renders checked");
  assert.equal(row("mixed").querySelector("input").indeterminate, true, "a partly included folder is indeterminate");
  assert.equal(row("big").querySelector("input").indeterminate, false, "…and a fully included row has the dash cleared");
  assert.ok(row("mixed").classList.contains("partial"), "…and is styled as such");
  assert.match(row("mixed").textContent, /3 of 5 files/, "…and says how far it is");
  assert.equal(row(".storage").querySelector("input").checked, false, "an ignored folder renders unchecked");
  assert.match(row(".storage").textContent, /\.storage\//, "…and names the rule that ignores it");

  // Unticking a 4 000-file folder writes one anchored folder rule — never
  // 4 000 lines — and leaves the rules above the block alone.
  toggle("big", false);
  await paint();
  assert.match(rules(), /(^|\n)\/big\/\n/, "unchecking a folder writes one folder rule");
  assert.equal(rules().split("\n").filter((line) => line.startsWith("big/")).length, 0, "no per-file lines are written");
  assert.match(rules(), /^\.storage\/\n\*\.cache\n/, "the rules above the explorer block are untouched");
  const scan = server.requests().at(-1).body;
  assert.match(scan.ignore, /\/big\//, "the refreshed scan is asked with the new rules");

  // Ticking it again deletes that rule and writes nothing else, because
  // nothing above re-ignores the folder.
  levels[""] = { entries: [dirEntry("big", { ignored: true, pattern: "/big/", files: 0, included: 0, excluded: 0, dirs: 0, complete: false, unknown: true }), mixed(), storage()] };
  await modules.actions.refreshExplorer();
  await paint();
  toggle("big", true);
  await paint();
  assert.ok(!rules().includes("/big/"), "ticking the folder removes the folder rule again");
  assert.ok(!rules().includes("!/big/"), "…and writes a re-include only when one is needed");

  // Ticking a folder that a *user* rule ignores must not edit that rule: the
  // explorer beats it from inside its own block instead.
  levels[""] = { entries: [big(), mixed(), storage()] };
  await modules.actions.refreshExplorer();
  await paint();
  toggle(".storage", true);
  await paint();
  assert.match(rules(), /^\.storage\/\n/, "the preset line stays exactly where it was");
  assert.match(rules(), /(^|\n)!\/\.storage\/\n/, "the folder is re-included from the block");
  assert.match(rules(), /(^|\n)!\/\.storage\/\*\*\n/, "…together with everything below it");

  // One tick on a mixed folder completes it: the chain covers its files too.
  toggle("mixed", true);
  await paint();
  assert.match(rules(), /(^|\n)!\/mixed\/\*\*\n/, "ticking a partial folder includes its files as well");
});

test("file explorer opens folders on click and pages huge levels", async () => {
  const many = Array.from({ length: 205 }, (_unused, index) => fileEntry(`dump/state-${index}.yaml`));
  const levels = {
    "": { entries: [dirEntry("esphome", { files: 2, included: 2, dirs: 1 }), ...many], total: 1 + many.length },
    esphome: { entries: [dirEntry("esphome/living", { files: 2, included: 2 }), fileEntry("esphome/kitchen.yaml")] },
    "esphome/living": { entries: [fileEntry("esphome/living/lights.yaml"), fileEntry("esphome/living/script.yaml")] },
  };
  const server = previewTreeServer({ levels, root: { files: 208, included: 208, excluded: 0, dirs: 2, complete: true } });
  const root = await boot({ handlers: { "api/preview_tree": server } });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "" });
  modules.actions.gotoStep(3);
  await paint();

  // Only what the request asked for is on screen: the root, one page of it.
  assert.ok(explorerRow(root, "esphome"), "the mapping folder lists its folders first");
  assert.ok(explorerRow(root, "state-198.yaml"), "…up to one page of files");
  assert.ok(!explorerRow(root, "state-199.yaml"), "and not beyond it");
  assert.equal(treeRowsOf(root).length, 200, "a level is paged instead of being cut off");
  const more = root.querySelector(".tree-more");
  assert.ok(more, "a paged level offers Show more instead of hiding rows");
  assert.match(more.textContent, /6 entries more in this folder/, "…and says how many are left");
  assert.ok(!explorerRow(root, "kitchen.yaml"), "closed folders are not rendered");

  // Clicking a folder name opens it — and asks for exactly that level.
  explorerRow(root, "esphome").querySelector(".tree-name").click();
  await paint();
  assert.deepEqual(modules.state.treeExpanded.value, ["esphome"], "the open folder is remembered");
  assert.deepEqual(
    server.requests().at(-1).body.levels.map((item) => item.path),
    ["", "esphome"],
    "opening a folder requests its level next to the root"
  );
  assert.ok(explorerRow(root, "kitchen.yaml"), "the opened folder shows its files");
  assert.ok(!explorerRow(root, "lights.yaml"), "nested folders stay closed until clicked");
  assert.ok(explorerRow(root, "esphome").classList.contains("open"), "the opened folder row says it is open");

  // The arrow opens and closes them the same way; closing needs no request.
  explorerRow(root, "living").querySelector(".tree-toggle").click();
  await paint();
  assert.ok(explorerRow(root, "lights.yaml"), "a nested folder expands the same way");
  assert.equal(treeRowsOf(root).length, 204, "rows appear exactly where the tree puts them");
  const lights = explorerRow(root, "lights.yaml");
  assert.match(`${lights.style.cssText}`, /padding-left:38px/, "depth becomes indentation");

  const requests = server.requests().length;
  explorerRow(root, "living").querySelector(".tree-toggle").click();
  await paint();
  assert.ok(!explorerRow(root, "lights.yaml"), "collapse hides the children again");
  assert.equal(server.requests().length, requests, "collapsing asks for nothing");

  // Show more appends the next page instead of replacing what is on screen.
  more.querySelector("button").click();
  await paint();
  assert.equal(treeRowsOf(root).length, 208, "Show more keeps the earlier rows and adds the rest");
  assert.ok(!root.querySelector(".tree-more"), "…and the control disappears once the level is complete");
  const tail = explorerRow(root, "state-204.yaml");
  assert.ok(tail, "the very last file of a 206-entry folder is reachable");
  const input = tail.querySelector("input");
  input.checked = false;
  input.dispatchEvent({ type: "change" });
  await paint();
  assert.match(
    modules.state.editor.value.ignore_upload,
    /(^|\n)dump\/state-204\.yaml\n/,
    "…and can be unticked like any other file"
  );
});

test("file explorer flags a level the server capped instead of paging forever", async () => {
  const huge = Array.from({ length: 6 }, (_unused, index) => fileEntry(`dump/state-${index}.yaml`));
  const server = previewTreeServer({
    levels: { "": { entries: huge, total: huge.length, capped: true } },
    root: { files: 6, included: 6, excluded: 0, dirs: 0, complete: true },
  });
  const root = await boot({ handlers: { "api/preview_tree": server } });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "" });
  modules.actions.gotoStep(3);
  await paint();

  assert.ok(explorerRow(root, "state-0.yaml"), "the listed rows are still there and tickable");
  const more = root.querySelector(".tree-more");
  assert.ok(more, "a capped level says so instead of ending silently");
  assert.match(more.textContent, /filter/i, "…and points at the filter box, which reaches the rest");
  assert.equal(more.querySelector("button"), null, "…with no Show more that could never finish");
});

test("explorer Check all and Uncheck all work from any state", async () => {
  const levels = {
    "": {
      entries: [
        dirEntry("esphome", { files: 3, included: 2, excluded: 1 }),
        fileEntry("a.yaml"),
        fileEntry("b.log", { ignored: true, pattern: "*.log" }),
      ],
    },
  };
  let rootCounts = { files: 4, included: 3, excluded: 1, dirs: 1, ignored_dirs: 0, included_size: 40, complete: true };
  const server = previewTreeServer({ levels, root: () => rootCounts });
  const root = await boot({ handlers: { "api/preview_tree": server } });
  await modules.actions.refresh();

  modules.actions.startNewMapping();
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "*.log\nsecrets.yaml\n" });
  modules.actions.gotoStep(3);
  await paint();

  const button = (label) => findButton(root, label);
  const rules = () => modules.state.editor.value.ignore_upload;

  // The regression this whole change is about: while any file was already
  // ignored, "Uncheck all" used to stay disabled forever — it looked dead.
  assert.equal(button("Uncheck all").disabled, false, "Uncheck all works while something is unchecked");
  assert.equal(button("Check all").disabled, false, "Check all works while something is ignored");

  button("Uncheck all").click();
  await paint();
  assert.match(rules(), /^\*\.log\nsecrets\.yaml\n/, "the user's own rules stay above the block");
  assert.match(rules(), /# GitHub Sync selection[^\n]*\n\*\n$/, "the block holds exactly one catch-all rule");
  assert.equal(rules().split("\n").filter((line) => line.trim() === "*").length, 1, "one `*` rule ignores the whole side");

  // Pressing it twice must not stack rules — it says so instead.
  const before = rules();
  button("Uncheck all").click();
  await paint();
  assert.equal(rules(), before, "a second press is a no-op");
  assert.ok(
    modules.state.toasts.value.some((toast) => /already unchecked/.test(toast.message)),
    "…and the toast explains why"
  );

  // Check all reverses it with `!**`, still leaving the user's rules alone.
  button("Check all").click();
  await paint();
  assert.match(rules(), /(^|\n)!\*\*\n/, "Check all re-includes everything below the block marker");
  assert.ok(!/(^|\n)\*(\n|$)/.test(rules()), "the catch-all line is gone");
  assert.match(rules(), /^secrets\.yaml$/m, "secrets.yaml is untouched by Check all");

  // Reset selection removes only what the explorer wrote.
  button("Reset selection").click();
  await paint();
  assert.equal(rules(), "*.log\nsecrets.yaml\n", "Reset selection leaves exactly the user's rules");

  // Once nothing is included, Uncheck all rests…
  rootCounts = { files: 4, included: 0, excluded: 4, dirs: 0, ignored_dirs: 0, complete: true };
  levels[""] = { entries: [fileEntry("a.yaml", { ignored: true, pattern: "*" })] };
  await modules.actions.refreshExplorer();
  await paint();
  assert.equal(button("Uncheck all").disabled, true, "nothing left to uncheck disables the button");
  assert.equal(button("Check all").disabled, false, "…while Check all stays available");

  // …but while the scan is cut short the counts are not the truth, so both
  // buttons stay clickable rather than lying about the folder.
  rootCounts = { files: 40, included: 0, excluded: 40, dirs: 0, ignored_dirs: 0, complete: false };
  await modules.actions.refreshExplorer({ depth: 2 });
  await paint();
  assert.equal(button("Uncheck all").disabled, false, "a partial scan keeps Uncheck all usable");
  assert.match(root.innerHTML, /scan limit/, "and the explorer flags the partial scan");
});

test("explorer filter searches the whole folder, not just what is open", async () => {
  const levels = { "": { entries: [dirEntry("esphome", { files: 4, included: 4, dirs: 1 })] } };
  const server = previewTreeServer({
    levels,
    root: { files: 4, included: 4, excluded: 0, dirs: 1, complete: true },
    search: (query) => ({
      query,
      total: 2,
      entries: [
        fileEntry("esphome/living/lights.yaml"),
        fileEntry("esphome/living/script.yaml", { ignored: true, pattern: "*.yaml" }),
      ],
    }),
  });
  const root = await boot({ handlers: { "api/preview_tree": server } });
  await modules.actions.refresh();
  modules.actions.startNewMapping();
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "*.yaml\n" });
  modules.actions.gotoStep(3);
  await paint();

  modules.state.treeQuery.value = "lights";
  await modules.actions.refreshExplorer();
  await paint();

  assert.equal(server.requests().at(-1).body.query, "lights", "the filter travels to the explorer request");
  assert.match(root.innerHTML, /2 matches for “lights”/, "the head line explains the flat result list");
  assert.match(root.innerHTML, /esphome\/living\/lights\.yaml/, "hits show their full path");
  assert.ok(explorerRow(root, "script.yaml").classList.contains("unchecked"), "hits keep their tick state");

  const hit = explorerRow(root, "lights.yaml").querySelector("input");
  hit.checked = false;
  hit.dispatchEvent({ type: "change" });
  await paint();
  assert.match(
    modules.state.editor.value.ignore_upload,
    /(^|\n)esphome\/living\/lights\.yaml\n/,
    "a hit can be unticked straight from the search list"
  );

  // Typing in the rules box re-scans after a short pause, so the tree follows
  // the rules without firing one request per keystroke.
  const requests = server.requests().length;
  const textarea = [...root.querySelectorAll("textarea")].at(-1);
  textarea.value = "*.yaml\n*.db\n";
  const typedAt = Date.now();
  textarea.dispatchEvent({ type: "input" });
  await microtasks();
  assert.equal(server.requests().length, requests, "the keystroke itself sends nothing");
  assert.ok(
    await waitFor(() => server.requests().length > requests),
    "the explorer refreshes once the keystrokes stop"
  );
  assert.ok(Date.now() - typedAt >= 180, "…but not before the debounce window has passed");

  // Clearing the filter goes back to the tree.
  modules.state.treeQuery.value = "";
  await modules.actions.refreshExplorer();
  await paint();
  assert.ok(explorerRow(root, "esphome"), "clearing the filter shows the tree again");
});


test("unchecked preview rows keep readable text (no strikethrough)", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "github_sync", "app", "static", "styles.css"),
    "utf8"
  );
  const excludedRules = css.match(/\.list-row\.excluded[^}]*}/g) || [];
  assert.ok(excludedRules.length, "excluded row styles exist");
  for (const rule of excludedRules) {
    assert.ok(!rule.includes("line-through"), `excluded rows stay readable: ${rule}`);
  }
});

test("settings links to the GitHub page that manages repository access", async () => {
  const root = await boot();
  modules.state.view.value = "settings";
  await paint();
  const oauthLink = [...root.querySelectorAll("a")].find((node) =>
    (node.getAttribute("href") || "").startsWith("https://github.com/settings/")
  );
  assert.ok(oauthLink, "settings links to a GitHub configuration page");
  assert.equal(oauthLink.getAttribute("href"), "https://github.com/settings/applications");
  assert.equal(oauthLink.getAttribute("target"), "_blank");
  assert.match(oauthLink.textContent, /Review authorization on GitHub/);

  const tokenRoot = await boot({ status: { ...STATUS, auth_method: "token" } });
  modules.state.view.value = "settings";
  await paint();
  const tokenLink = [...tokenRoot.querySelectorAll("a")].find((node) =>
    (node.getAttribute("href") || "").includes("personal-access-tokens")
  );
  assert.ok(tokenLink, "token connections link to the fine-grained token page");
  assert.match(tokenLink.textContent, /Add or remove repositories on GitHub/);
});

test("logout clears account state and returns to the connect screen", async () => {
  const root = await boot();
  await modules.actions.refresh();
  assert.match(root.innerHTML, /ESPHome/);
  await modules.actions.logout();
  assert.equal(calls.some((call) => call.url === "api/token" && call.method === "DELETE"), true);
  assert.equal(modules.state.status.value.configured, false);
  assert.equal(modules.state.repos.value, null, "account caches are dropped");
  await paint();
  assert.match(root.innerHTML, /Connect GitHub to get started/);
});

test("every view and overlay renders (settings, wizard steps, diff, dialogs, busy)", async () => {
  const root = await boot({
    responses: {
      "api/browse?path=": { path: "", parent: null, root: "Home Assistant", entries: [{ name: "homeassistant", path: "homeassistant", is_dir: true, is_symlink: false }] },
      "api/browse?path=homeassistant": { path: "homeassistant", parent: "", root: "Home Assistant", entries: [{ name: "esphome", path: "homeassistant/esphome", is_dir: true, is_symlink: true }] },
      "api/repos": { repos: [{ full_name: "owner/ha-esphome", default_branch: "main", private: true, description: "ESPHome" }] },
      "api/branches?repository=owner%2Fha-esphome": { branches: ["main"] },
      "api/preview_ignore": { direction: "upload", included: [{ path: "a.yaml", size: 10 }], excluded: [{ path: "b.log", size: 4, pattern: "*.log" }], included_count: 1, excluded_count: 1, included_size: 10, truncated: true },
    },
  });
  await modules.actions.refresh();

  // Settings
  modules.state.view.value = "settings";
  await paint();
  assert.match(root.innerHTML, /App updates/);
  assert.match(root.innerHTML, /How sync works/);
  assert.match(root.innerHTML, /owner\/ha-config/);

  // Wizard, all four steps
  modules.actions.startNewMapping();
  await paint();
  assert.match(root.innerHTML, /Which Home Assistant folder/);
  await modules.actions.browse("homeassistant");
  await paint();
  assert.match(root.innerHTML, /link/);
  for (const step of [2, 3, 4]) {
    modules.actions.gotoStep(step);
    await paint();
  }
  assert.match(root.innerHTML, /Enable automatic sync/);
  assert.match(root.innerHTML, /Commit message template/);

  // Check result and dry-run plan
  modules.state.view.value = "diff";
  modules.state.diff.value = {
    mapping_id: "m1",
    repository: "owner/ha-esphome",
    branch: "main",
    commit_sha: "abcdef1234567890",
    empty_repo: true,
    added: [{ path: "a.yaml", size: 10 }],
    modified: [{ path: "b.yaml", size: 20 }],
    removed_locally: [{ path: "c.yaml", size: 30 }],
    conflicts: [{ path: "d.yaml", size: 40 }],
    unchanged: 5,
    skipped: [],
    upload_count: 2,
    download_count: 3,
    file_shas: {},
  };
  await paint();
  assert.match(root.innerHTML, /Update check/);
  assert.match(root.innerHTML, /Conflicts detected/);
  assert.match(root.innerHTML, /abcdef1/);

  modules.state.diffFilter.value = "conflict";
  await paint();
  assert.match(root.innerHTML, /d\.yaml/);

  modules.state.diff.value = {
    dry_run: true,
    direction: "upload",
    target: "GitHub",
    repository: "owner/ha-esphome",
    branch: "main",
    commit_sha: "abcdef1",
    actions: [{ path: "x.yaml", action: "delete" }],
    create_count: 0,
    update_count: 0,
    delete_count: 1,
    unchanged: 0,
    skipped: 2,
  };
  await paint();
  assert.match(root.innerHTML, /Upload preview/);
  assert.match(root.innerHTML, /would delete/);

  // Dialogs and overlays
  modules.state.devicePopup.value = {
    flow_id: "f1",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    status: "pending",
  };
  await paint();
  assert.match(root.innerHTML, /ABCD-1234/);
  assert.match(root.innerHTML, /Waiting for approval/);

  modules.state.devicePopup.value = { flow_id: "f1", status: "error", error: "Code expired" };
  await paint();
  assert.match(root.innerHTML, /Authorization failed/);

  modules.state.devicePopup.value = null;
  modules.state.busy.value = { label: "Uploading to GitHub…", message: "Sending blob 2 of 5", current: 2, total: 5 };
  await paint();
  assert.match(root.innerHTML, /Sending blob 2 of 5/);
  assert.match(root.innerHTML, /2 \/ 5/);

  modules.state.busy.value = null;
  modules.state.updating.value = true;
  await paint();
  assert.match(root.innerHTML, /Updating GitHub Sync/);
  modules.state.updating.value = false;

  modules.state.toasts.value = [{ id: 99, message: "Mapping saved", tone: "success" }];
  await paint();
  assert.match(root.innerHTML, /Mapping saved/);
  modules.state.toasts.value = [];

  modules.state.error.value = "Boom";
  await paint();
  assert.match(root.innerHTML, /Something went wrong/);
  modules.state.error.value = null;
});
