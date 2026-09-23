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

/** Wait for pending signal-driven re-renders. */
const paint = flush;

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

test("editor wizard walks folder → repo → rules → review and saves one mapping", async () => {
  const root = await boot({
    responses: {
      "api/browse?path=": { path: "", parent: null, root: "Home Assistant", entries: [{ name: "homeassistant", path: "homeassistant", is_dir: true }] },
      "api/repos": { repos: [{ full_name: "owner/ha-esphome", default_branch: "main", private: false, description: "ESPHome config" }] },
      "api/branches?repository=owner%2Fha-esphome": { branches: ["main", "dev"] },
      "api/preview_ignore": { direction: "upload", included: [{ path: "esphome/kitchen.yaml", size: 120 }], excluded: [], included_count: 1, excluded_count: 0, excluded_file_count: 0, included_size: 120, truncated: false },
    },
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

  modules.actions.gotoStep(2);
  await modules.actions.loadRepos();
  await paint();
  assert.match(root.innerHTML, /owner\/ha-esphome/);
  await modules.actions.pickRepo("owner/ha-esphome", "main");
  await paint();
  assert.deepEqual(modules.state.branches.value, ["main", "dev"]);

  modules.actions.gotoStep(3);
  await modules.actions.refreshIgnorePreview();
  await paint();
  const folderRow = [...root.querySelectorAll("label")].find(
    (node) => node.classList.contains("list-row") && node.classList.contains("folder")
  );
  assert.ok(folderRow, "files inside a folder collapse into a single folder row");
  assert.match(folderRow.textContent, /esphome/);
  assert.match(folderRow.textContent, /1 file/);
  assert.equal(folderRow.querySelector("input").checked, true, "fully included folder renders checked");

  modules.actions.gotoStep(4);
  await paint();
  assert.match(root.innerHTML, /Enable automatic sync/);
  await modules.actions.saveMapping();

  const saved = calls.find((call) => call.url === "api/mappings" && call.method === "POST");
  assert.equal(saved.body.local_path, "homeassistant");
  assert.equal(saved.body.repository, "owner/ha-esphome");
  assert.equal(saved.body.branch, "main");
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

test("ignore preview checkboxes uncheck, re-check and chain-negate files", async () => {
  const preview = {
    direction: "upload",
    included: [
      { path: "a.yaml", size: 10, is_dir: false },
      { path: "sub/c.yaml", size: 6, is_dir: false },
    ],
    excluded: [{ path: "b.log", size: 4, is_dir: false, pattern: "*.log" }],
    included_count: 2,
    excluded_count: 1,
    excluded_file_count: 1,
    included_size: 16,
    truncated: false,
  };
  const root = await boot({ responses: { "api/preview_ignore": preview } });
  await modules.actions.refresh();
  const setPreview = (included, excluded) => {
    preview.included = included;
    preview.excluded = excluded;
    preview.included_count = included.length;
    preview.excluded_count = excluded.length;
    preview.excluded_file_count = excluded.filter((item) => !item.is_dir).length;
    preview.included_size = included.reduce((sum, file) => sum + (file.size || 0), 0);
  };

  modules.actions.startNewMapping();
  modules.state.ignoreSide.value = "upload";
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "*.log\n" });
  modules.actions.gotoStep(3);
  await paint();
  assert.match(root.innerHTML, /a\.yaml/);

  const checkboxOf = (name) => {
    const row = [...root.querySelectorAll("label")].find(
      (node) => node.classList.contains("list-row") && node.textContent.includes(name)
    );
    assert.ok(row, `a checkbox row exists for ${name}`);
    return { row, input: row.querySelector("input") };
  };
  const toggle = (name, checked) => {
    const { input } = checkboxOf(name);
    input.checked = checked;
    input.dispatchEvent({ type: "change" });
  };
  const rules = () => modules.state.editor.value.ignore_upload;
  const uncheckAllButton = () => findButton(root, "Uncheck all");

  // "Uncheck all" stays disabled while anything is unchecked.
  assert.ok(uncheckAllButton(), "preview offers Uncheck all");
  assert.equal(uncheckAllButton().disabled, true, "b.log is unchecked, so the button is disabled");

  // Unchecking an included file excludes it with an exact rule.
  assert.equal(checkboxOf("a.yaml").input.checked, true);
  toggle("a.yaml", false);
  await paint();
  assert.match(rules(), /(^|\n)a\.yaml\n/, "uncheck adds an exact ignore line");

  // Checking the now-excluded file removes that rule again.
  setPreview([{ path: "sub/c.yaml", size: 6, is_dir: false }], [
    { path: "a.yaml", size: 10, is_dir: false, pattern: "a.yaml" },
    { path: "b.log", size: 4, is_dir: false, pattern: "*.log" },
  ]);
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.ok(checkboxOf("a.yaml").row.classList.contains("excluded"), "file moved to the ignored section");
  toggle("a.yaml", true);
  await paint();
  assert.equal(rules().trim(), "*.log", "check removes the exact ignore line");

  // Everything checked → the button unlocks, appends one catch-all rule and
  // never duplicates it.
  setPreview(
    [
      { path: "a.yaml", size: 10, is_dir: false },
      { path: "sub/c.yaml", size: 6, is_dir: false },
    ],
    []
  );
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.equal(uncheckAllButton().disabled, false, "all rows checked unlocks Uncheck all");
  uncheckAllButton().click();
  await paint();
  assert.equal(rules().trim().split("\n").filter((line) => line.trim() === "*").length, 1, "one `*` rule added");
  assert.match(rules(), /(^|\n)\*\n/);
  uncheckAllButton().click();
  await paint();
  assert.equal(rules().trim().split("\n").filter((line) => line.trim() === "*").length, 1, "no duplicate `*` rule");
  const previewCall = [...calls].reverse().find((call) => call.url === "api/preview_ignore" && call.body);
  assert.match(previewCall.body.ignore, /(^|\n)\*(\n|$)/, "preview refresh sends the new rules");

  // With the catch-all in place every row is unchecked → the button disables
  // again until everything is ticked back in.
  setPreview([], [
    { path: "a.yaml", size: 10, is_dir: false, pattern: "*" },
    { path: "b.log", size: 4, is_dir: false, pattern: "*" },
    { path: "sub/c.yaml", size: 6, is_dir: false, pattern: "*" },
  ]);
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.equal(uncheckAllButton().disabled, true, "everything unchecked disables Uncheck all again");

  // Ticking the folder row re-includes all of its files: parent first, then files.
  toggle("sub", true);
  await paint();
  assert.match(rules(), /(^|\n)!\/sub\/\n/, "parent folder is re-included first");
  assert.match(rules(), /(^|\n)!\/sub\/c\.yaml\n/, "the file itself is re-included");

  // Unticking the folder again removes only the file negation, not the chain.
  setPreview([{ path: "sub/c.yaml", size: 6, is_dir: false }], [
    { path: "a.yaml", size: 10, is_dir: false, pattern: "*" },
    { path: "b.log", size: 4, is_dir: false, pattern: "*" },
  ]);
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.equal(checkboxOf("sub").input.checked, true, "fully included folder renders checked");
  toggle("sub", false);
  await paint();
  assert.ok(!/(^|\n)!\/sub\/c\.yaml(\n|$)/.test(rules()), "the file negation is removed");
  assert.match(rules(), /(^|\n)!\/sub\/(\n|$)/, "ancestor negation stays for other selections");
});

test("preview groups folder files into folder rows and gates Uncheck all", async () => {
  const file = (path, size, extra = {}) => ({ path, size, is_dir: false, ...extra });
  const preview = {
    direction: "upload",
    included: [
      file("a.yaml", 10),
      file("sub/c.yaml", 6),
      file("sub/nested/d.yaml", 8),
      file("other/e.yaml", 4),
    ],
    excluded: [
      file("sub/junk.log", 2, { pattern: "*.log" }),
      { path: ".storage", is_dir: true, size: 0, pattern: ".storage/" },
      { path: ".git", is_dir: true, size: 0, pattern: ".git/", always_ignored: true },
    ],
    included_count: 4,
    excluded_count: 3,
    excluded_file_count: 1,
    included_size: 28,
    truncated: false,
  };
  const root = await boot({ responses: { "api/preview_ignore": preview } });
  await modules.actions.refresh();
  const setPreview = (included, excluded) => {
    preview.included = included;
    preview.excluded = excluded;
    preview.included_count = included.length;
    preview.excluded_count = excluded.length;
    preview.excluded_file_count = excluded.filter((item) => !item.is_dir).length;
    preview.included_size = included.reduce((sum, item) => sum + (item.size || 0), 0);
  };

  modules.actions.startNewMapping();
  modules.state.ignoreSide.value = "upload";
  modules.actions.patchEditor({ local_path: "homeassistant", ignore_upload: "*.log\n.storage/\n" });
  modules.actions.gotoStep(3);
  await paint();

  const row = (name) =>
    [...root.querySelectorAll("label")].find(
      (node) => node.classList.contains("list-row") && node.textContent.includes(name)
    );
  const toggle = (name, checked) => {
    const target = row(name);
    assert.ok(target, `a checkbox row exists for ${name}`);
    const input = target.querySelector("input");
    input.checked = checked;
    input.dispatchEvent({ type: "change" });
  };
  const rules = () => modules.state.editor.value.ignore_upload;
  const uncheckAllButton = () => findButton(root, "Uncheck all");

  // Folders collapse into single rows with tri-state checkboxes.
  const sub = row("sub");
  assert.ok(sub.classList.contains("folder"), "nested files collapse into a folder row");
  assert.match(sub.textContent, /2 of 3 files/, "partial folder shows included vs total");
  assert.equal(sub.querySelector("input").checked, false, "partial folder is not fully checked");
  assert.ok(!sub.classList.contains("excluded"), "partial folders keep readable text");
  const other = row("other");
  assert.equal(other.querySelector("input").checked, true, "fully included folder renders checked");
  assert.match(other.textContent, /1 file/);

  // Always-ignored folders stay hidden; pruned folders remain selectable.
  assert.ok(!row(".git"), ".git is hidden from the list");
  const storage = row(".storage");
  assert.ok(storage.classList.contains("folder"), "pruned folders still get a row");
  assert.equal(storage.querySelector("input").checked, false, "pruned folder is unchecked");
  assert.match(storage.textContent, /\.storage\//);

  // "Uncheck all" stays disabled while anything is unchecked.
  assert.equal(uncheckAllButton().disabled, true);

  // Unchecking a fully checked folder writes one exact rule per file.
  toggle("other", false);
  await paint();
  assert.match(rules(), /(^|\n)other\/e\.yaml\n/, "folder uncheck adds per-file rules");

  // Checking a partial folder ticks only its excluded file, chain-negated.
  setPreview([file("a.yaml", 10), file("sub/c.yaml", 6), file("sub/nested/d.yaml", 8)], [
    file("other/e.yaml", 4, { pattern: "other/e.yaml" }),
    file("sub/junk.log", 2, { pattern: "*.log" }),
    { path: ".storage", is_dir: true, size: 0, pattern: ".storage/" },
  ]);
  await modules.actions.refreshIgnorePreview();
  await paint();
  toggle("sub", true);
  await paint();
  assert.match(rules(), /(^|\n)!\/sub\/\n/, "parent folder is re-included first");
  assert.match(rules(), /(^|\n)!\/sub\/junk\.log\n/, "the excluded file is re-included");

  // Unticking the now-fully-checked folder removes the file rule, keeps the chain.
  setPreview([
    file("a.yaml", 10),
    file("sub/c.yaml", 6),
    file("sub/nested/d.yaml", 8),
    file("sub/junk.log", 2),
  ], [
    file("other/e.yaml", 4, { pattern: "other/e.yaml" }),
    { path: ".storage", is_dir: true, size: 0, pattern: ".storage/" },
  ]);
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.equal(row("sub").querySelector("input").checked, true, "fully included folder renders checked");
  toggle("sub", false);
  await paint();
  assert.ok(!/(^|\n)!\/sub\/junk\.log(\n|$)/.test(rules()), "file negation is removed");
  assert.match(rules(), /(^|\n)!\/sub\/(\n|$)/, "ancestor negation stays for other selections");
  assert.match(rules(), /(^|\n)sub\/c\.yaml\n/, "included files are excluded with exact rules");

  // Everything checked again → the button unlocks.
  setPreview([
    file("a.yaml", 10),
    file("sub/c.yaml", 6),
    file("sub/nested/d.yaml", 8),
    file("other/e.yaml", 4),
  ], []);
  await modules.actions.refreshIgnorePreview();
  await paint();
  assert.equal(uncheckAllButton().disabled, false, "enabled once every row is checked");
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
