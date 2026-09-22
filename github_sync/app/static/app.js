const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const bytes = (n) => {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1048576) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / 1048576).toFixed(1)} MB`;
};

const relTime = (iso) => {
  if (!iso) return "Never synced";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const delta = Date.now() - then;
  const min = Math.round(delta / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return new Date(iso).toLocaleString();
};

const SVG = `<svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
  <rect x="8" y="20" width="36" height="28" rx="4" stroke="currentColor" stroke-width="3"/>
  <rect x="52" y="48" width="36" height="28" rx="4" stroke="currentColor" stroke-width="3"/>
  <path d="M44 34h8a12 12 0 0 1 12 12" stroke="currentColor" stroke-width="3"/>
  <path d="M52 62h-8A12 12 0 0 1 32 50" stroke="currentColor" stroke-width="3"/>
</svg>`;

const state = {
  view: "list",
  loading: true,
  error: null,
  busy: null,
  toast: null,
  status: { configured: false },
  mappings: [],
  presets: {},
  editor: null,
  browser: null,
  repos: null,
  repoQuery: "",
  branches: [],
  preview: null,
  ignoreSide: "upload",
  diff: null,
  confirm: null,
  tokenDraft: "",
  apiDraft: "https://api.github.com",
  oauthClientIdDraft: "",
  oauthClientSecretDraft: "",
  oauthRedirectDraft: "",
  oauthScopeDraft: "repo",
  oauthDevice: null,
  updates: {},
  updating: false,
};

function updateDismissed(version) {
  if (!version) return false;
  try {
    return localStorage.getItem("gsUpdateDismissed") === version;
  } catch (_err) {
    return false;
  }
}

function dismissUpdate(version) {
  try {
    localStorage.setItem("gsUpdateDismissed", version);
  } catch (_err) {
    /* storage unavailable */
  }
  render();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_err) {
    data = { detail: text };
  }
  if (!res.ok) throw new Error(data.detail || res.statusText || "Request failed");
  return data;
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function toast(message) {
  setState({ toast: message });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => setState({ toast: null }), 4200);
}

async function run(label, fn) {
  setState({ busy: label, error: null });
  const timer = setInterval(async () => {
    try {
      const snap = await api("api/progress");
      const msg = snap.latest?.message;
      if (msg) setState({ busy: msg });
    } catch (_err) {
      /* ignore poll errors */
    }
  }, 800);
  try {
    const result = await fn();
    clearInterval(timer);
    setState({ busy: null });
    return result;
  } catch (err) {
    clearInterval(timer);
    setState({ busy: null, error: err.message || String(err) });
    throw err;
  }
}

async function refresh() {
  setState({ loading: true, error: null });
  try {
    const [status, mappings, presets, updates] = await Promise.all([
      api("api/status"),
      api("api/mappings").catch(() => ({ mappings: [] })),
      api("api/presets").catch(() => ({ presets: {} })),
      api("api/updates").catch(() => ({})),
    ]);
    setState({
      loading: false,
      status,
      mappings: mappings.mappings || [],
      presets: presets.presets || {},
      updates,
      apiDraft: status.api_base || "https://api.github.com",
      oauthClientIdDraft: status.oauth?.client_id || "",
      oauthRedirectDraft: status.oauth?.redirect_uri || "",
      oauthScopeDraft: status.oauth?.scope || "repo",
    });
  } catch (err) {
    setState({ loading: false, error: err.message || String(err) });
  }
}

function blankEditor(existing) {
  const defaults = state.status.defaults || {};
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

function crumbs(path) {
  const parts = path ? path.split("/").filter(Boolean) : [];
  let acc = "";
  const bits = [`<button data-action="browse" data-path="">Home Assistant</button>`];
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    bits.push(
      `<span class="muted">/</span><button data-action="browse" data-path="${esc(acc)}">${esc(part)}</button>`
    );
  }
  return bits.join(" ");
}

async function onAction(action, el) {
  const id = el.dataset.id;
  if (action === "tab") return setState({ view: el.dataset.view, editor: null, diff: null, error: null });
  if (action === "refresh") return refresh();
  if (action === "add")
    return setState({ view: "editor", editor: blankEditor(), browser: null, preview: null });
  if (action === "edit") {
    const mapping = state.mappings.find((m) => m.id === id);
    if (mapping) setState({ view: "editor", editor: blankEditor(mapping), preview: null });
    return;
  }
  if (action === "delete")
    return setState({
      confirm: {
        title: "Remove mapping?",
        body: "The GitHub repository and local files are not deleted. Only this sync pairing is removed.",
        ok: "Remove",
        danger: true,
        next: { type: "delete", id },
      },
    });
  if (action === "check") return check(id);
  if (action === "upload")
    return setState({
      confirm: {
        title: "Upload to GitHub?",
        body: "Local files that are not ignored will be committed to the mapped branch.",
        ok: "Upload",
        next: { type: "upload", id },
      },
    });
  if (action === "download")
    return setState({
      confirm: {
        title: "Download from GitHub?",
        body: "Remote files will overwrite matching local files. Extra local files are kept unless you choose the cleanup option below.",
        ok: "Download",
        delete_extras: false,
        next: { type: "download", id },
      },
    });
  if (action === "cancel") return setState({ view: "list", editor: null, diff: null });
  if (action === "save") return save();
  if (action === "step") {
    const editor = { ...state.editor, step: Number(el.dataset.step) };
    setState({ editor });
    if (Number(el.dataset.step) === 2) ensureRepos();
    if (Number(el.dataset.step) === 3) preview();
    return;
  }
  if (action === "browse") return browse(el.dataset.path || state.editor?.local_path || "");
  if (action === "pickFolder") {
    const editor = {
      ...state.editor,
      local_path: el.dataset.path || "",
      name: state.editor.name || el.dataset.path || "",
    };
    return setState({ editor, browser: null });
  }
  if (action === "openDir") return browse(el.dataset.path || "");
  if (action === "pickRepo") return pickRepo(el.dataset.repo, el.dataset.branch);
  if (action === "preset") return applyPreset(el.dataset.preset);
  if (action === "preview") return preview();
  if (action === "ignoreSide") return setState({ ignoreSide: el.dataset.side, preview: null });
  if (action === "confirmOk") return confirmOk();
  if (action === "confirmCancel") return setState({ confirm: null });
  if (action === "backDiff") return setState({ view: "list", diff: null });
  if (action === "updateNow") {
    const up = state.updates || {};
    return setState({
      confirm: {
        title: "Update GitHub Sync now?",
        body: `The app asks Home Assistant to install v${up.latest_version || "the new version"} and restart it. This sidebar briefly disconnects and comes back automatically.`,
        ok: "Update now",
        next: { type: "updateApp", from: up.current_version },
      },
    });
  }
  if (action === "dismissUpdate") return dismissUpdate((state.updates || {}).latest_version);
  if (action === "checkUpdates") return checkUpdatesNow();
  if (action === "saveToken") return saveToken();
  if (action === "clearToken") return clearToken();
  if (action === "saveOAuth") return saveOAuthConfig();
  if (action === "useCallback") return setState({ oauthRedirectDraft: callbackUrl() });
  if (action === "deviceAuth") return startDeviceAuth();
  if (action === "webAuth") return startWebAuth();
  if (action === "cancelDevice") return cancelDeviceAuth();
}

async function browse(path) {
  try {
    const browser = await run("Opening folder…", () =>
      api(`api/browse?path=${encodeURIComponent(path || "")}`)
    );
    setState({ browser });
  } catch (_err) {
    /* error stored */
  }
}

async function ensureRepos() {
  if (state.repos) return;
  try {
    const data = await run("Loading repositories…", () => api("api/repos"));
    setState({ repos: data.repos || [] });
  } catch (_err) {
    setState({ repos: [] });
  }
}

async function pickRepo(fullName, defaultBranch) {
  const editor = {
    ...state.editor,
    repository: fullName,
    branch: state.editor.branch || defaultBranch || "main",
  };
  setState({ editor });
  try {
    const data = await api(`api/branches?repository=${encodeURIComponent(fullName)}`);
    setState({ branches: data.branches || [] });
  } catch (_err) {
    setState({ branches: defaultBranch ? [defaultBranch] : ["main"] });
  }
}

function applyPreset(key) {
  const preset = state.presets[key];
  if (!preset || !state.editor) return;
  const side = state.ignoreSide === "download" ? "ignore_download" : "ignore_upload";
  const current = state.editor[side] || "";
  if (current.includes(preset.patterns.trim())) return;
  state.editor[side] = `${current.trim()}\n# ${preset.label}\n${preset.patterns}`.trim() + "\n";
  preview();
}

async function preview() {
  const editor = state.editor;
  if (!editor?.local_path) return;
  const side = state.ignoreSide === "download" ? "ignore_download" : "ignore_upload";
  try {
    const data = await api("api/preview_ignore", {
      method: "POST",
      body: JSON.stringify({
        local_path: editor.local_path,
        ignore: editor[side] || "",
        direction: state.ignoreSide,
      }),
    });
    setState({ preview: data });
  } catch (err) {
    setState({ error: err.message || String(err) });
  }
}

async function save() {
  const editor = state.editor;
  if (!editor?.local_path || !editor?.repository) {
    setState({ error: "Choose a folder and a GitHub repository." });
    return;
  }
  try {
    await run("Saving mapping…", () =>
      api("api/mappings", {
        method: "POST",
        body: JSON.stringify({
          id: editor.id || undefined,
          name: editor.name,
          local_path: editor.local_path,
          repository: editor.repository,
          branch: editor.branch,
          repo_path: editor.repo_path,
          ignore_upload: editor.ignore_upload,
          ignore_download: editor.ignore_download,
          commit_message: editor.commit_message || undefined,
          auto_sync: Boolean(editor.auto_sync),
          auto_interval_minutes: Number(editor.auto_interval_minutes) || 60,
          auto_direction: editor.auto_direction || "upload",
        }),
      })
    );
    toast("Mapping saved");
    setState({ view: "list", editor: null });
    await refresh();
  } catch (_err) {
    /* stored */
  }
}

async function check(id) {
  try {
    const diff = await run("Comparing with GitHub…", () =>
      api("api/check", { method: "POST", body: JSON.stringify({ mapping_id: id }) })
    );
    setState({ view: "diff", diff });
  } catch (_err) {
    /* stored */
  }
}

async function confirmOk() {
  const confirm = state.confirm;
  setState({ confirm: null });
  if (!confirm?.next) return;
  const { type, id } = confirm.next;
  try {
    if (type === "updateApp") {
      await updateAppNow(confirm.next.from);
      return;
    }
    if (type === "delete") {
      await run("Removing mapping…", () => api(`api/mappings/${id}`, { method: "DELETE" }));
      toast("Mapping removed");
      await refresh();
      return;
    }
    if (type === "upload") {
      const result = await run("Uploading to GitHub…", () =>
        api("api/upload", { method: "POST", body: JSON.stringify({ mapping_id: id }) })
      );
      toast(`Uploaded ${result.uploaded} file(s)`);
      await refresh();
      return;
    }
    if (type === "download") {
      const result = await run("Downloading from GitHub…", () =>
        api("api/download", {
          method: "POST",
          body: JSON.stringify({
            mapping_id: id,
            delete_extras: Boolean(confirm.delete_extras),
          }),
        })
      );
      const removed = result.deleted ? `, removed ${result.deleted} extra file(s)` : "";
      toast(`Downloaded ${result.downloaded} file(s)${removed}`);
      await refresh();
    }
  } catch (_err) {
    /* stored */
  }
}

async function checkUpdatesNow() {
  try {
    const updates = await run("Checking for app updates…", () =>
      api("api/updates/check", { method: "POST" })
    );
    setState({ updates });
    if (updates.update_available) toast(`Version ${updates.latest_version} is available`);
    else toast("GitHub Sync is up to date");
  } catch (_err) {
    /* stored */
  }
}

async function updateAppNow(from) {
  setState({ updating: true, error: null });
  try {
    await api("api/updates/install", { method: "POST" });
  } catch (err) {
    // Home Assistant restarts this container as part of the update, so the
    // response is often cut short. Keep waiting for the app to come back.
    console.warn("Update request did not answer:", err.message || err);
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && state.updating) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let data = null;
    try {
      data = await api("api/updates");
    } catch (_err) {
      continue; // app is restarting
    }
    if (data && data.current_version && data.current_version !== from) {
      try {
        localStorage.removeItem("gsUpdateDismissed");
      } catch (_e) {
        /* ignore */
      }
      setState({ updating: false, updates: data });
      toast(`Updated to v${data.current_version}`);
      refresh();
      return;
    }
  }
  if (state.updating) {
    setState({
      updating: false,
      error:
        "The app has not confirmed the new version yet. The update may still be running — close and reopen GitHub Sync in a moment.",
    });
  }
}

async function saveToken() {
  try {
    await run("Connecting to GitHub…", () =>
      api("api/token", {
        method: "POST",
        body: JSON.stringify({
          access_token: state.tokenDraft,
          api_base: state.apiDraft,
        }),
      })
    );
    state.tokenDraft = "";
    toast("GitHub connected");
    await refresh();
  } catch (_err) {
    /* stored */
  }
}

async function clearToken() {
  try {
    await run("Removing token…", () => api("api/token", { method: "DELETE" }));
    toast("Token removed");
    await refresh();
  } catch (_err) {
    /* stored */
  }
}

function callbackUrl() {
  return new URL("api/oauth/callback", window.location.href).href;
}

async function saveOAuthConfig(showToast = true) {
  const result = await run("Saving authorization settings…", () =>
    api("api/oauth/config", {
      method: "POST",
      body: JSON.stringify({
        client_id: state.oauthClientIdDraft,
        client_secret: state.oauthClientSecretDraft || undefined,
        redirect_uri: state.oauthRedirectDraft,
        scope: state.oauthScopeDraft,
      }),
    })
  );
  state.oauthClientSecretDraft = "";
  setState({ status: result });
  if (showToast) toast("Authorization settings saved");
  return result;
}

async function startDeviceAuth() {
  try {
    await saveOAuthConfig(false);
    const device = await run("Starting GitHub device authorization…", () =>
      api("api/oauth/device/start", { method: "POST" })
    );
    setState({ oauthDevice: { ...device, status: "pending" } });
    toast(`Enter code ${device.user_code} on GitHub`);
    pollDeviceAuth(device.flow_id, (device.interval || 5) * 1000);
  } catch (_err) {
    /* stored */
  }
}

async function pollDeviceAuth(flowId, delay) {
  setTimeout(async () => {
    if (!state.oauthDevice || state.oauthDevice.flow_id !== flowId) return;
    try {
      const result = await api("api/oauth/device/poll", {
        method: "POST",
        body: JSON.stringify({ flow_id: flowId }),
      });
      if (result.status === "pending") {
        setState({ oauthDevice: { ...state.oauthDevice, status: "pending" } });
        pollDeviceAuth(flowId, Math.max(1000, (result.retry_after || 5) * 1000));
        return;
      }
      setState({ oauthDevice: null });
      toast(`GitHub authorized as @${result.account?.username || "user"}`);
      await refresh();
    } catch (err) {
      setState({ oauthDevice: null, error: err.message || String(err) });
    }
  }, delay);
}

async function cancelDeviceAuth() {
  const flowId = state.oauthDevice?.flow_id;
  if (flowId) await api(`api/oauth/device/${encodeURIComponent(flowId)}`, { method: "DELETE" }).catch(() => {});
  setState({ oauthDevice: null });
}

async function startWebAuth() {
  try {
    await saveOAuthConfig(false);
    const result = await run("Opening GitHub authorization…", () =>
      api("api/oauth/web/start", {
        method: "POST",
        body: JSON.stringify({ return_to: window.location.pathname + window.location.search }),
      })
    );
    window.location.assign(result.authorize_url);
  } catch (_err) {
    /* stored */
  }
}

function renderUpdateBanner() {
  const up = state.updates || {};
  if (!up.update_available || !up.latest_version || state.updating) return "";
  if (updateDismissed(up.latest_version)) return "";
  return `<div class="banner update-banner">
    <span>⬆️ <strong>New version v${esc(up.latest_version)}</strong> of GitHub Sync is available — you have v${esc(up.current_version || "unknown")}.</span>
    <span class="row" style="margin-top:0">
      <button class="btn ok" data-action="updateNow">Update now</button>
      <button class="btn ghost" data-action="dismissUpdate">Later</button>
    </span>
  </div>`;
}

function renderList() {
  const s = state;
  if (s.loading) return `<p class="meta">Loading mappings…</p>`;
  if (!s.status?.configured) {
    return `<div class="empty">${SVG}<h2>Connect GitHub first</h2>
      <p>Open Settings and connect GitHub — one-click device login, or paste a personal access token — then map folders.</p>
      <div class="row" style="justify-content:center"><button class="btn" data-action="tab" data-view="settings">Open settings</button></div></div>`;
  }
  const cards = (s.mappings || [])
    .map((m) => {
      const last = m.last_sync;
      return `<article class="card">
        <h3>${esc(m.name || m.local_path)}</h3>
        <div class="meta">
          Folder: <code>${esc(m.local_path)}</code><br>
          Repo: <strong>${esc(m.repository)}</strong> · ${esc(m.branch)}${m.repo_path ? ` · ${esc(m.repo_path)}` : ""}<br>
          ${last ? `${esc(last.direction)} · ${esc(relTime(last.at))}` : "Never synced"}
          ${m.auto_sync ? `<br>Auto: ${esc(m.auto_direction)} every ${esc(m.auto_interval_minutes)} min` : ""}
          ${m.last_error ? `<br><span style="color:var(--err)">Last error: ${esc(m.last_error)}</span>` : ""}
        </div>
        <div class="row">
          <button class="btn ghost" data-action="check" data-id="${esc(m.id)}">Check for updates</button>
          <button class="btn ok" data-action="upload" data-id="${esc(m.id)}">Upload</button>
          <button class="btn" data-action="download" data-id="${esc(m.id)}">Download</button>
          <button class="btn ghost" data-action="edit" data-id="${esc(m.id)}">Edit</button>
          <button class="btn danger" data-action="delete" data-id="${esc(m.id)}">Remove</button>
        </div>
      </article>`;
    })
    .join("");
  return `${s.mappings.length ? `<div class="grid">${cards}</div>` : `<div class="empty">${SVG}
      <h2>No folders mapped yet</h2>
      <p>Pick a Home Assistant folder, point it at a GitHub repository, tune ignore rules, then upload or download.</p>
    </div>`}
    <div class="row"><button class="btn" data-action="add">+ Add folder sync</button></div>`;
}

function renderEditor() {
  const e = state.editor || blankEditor();
  const step = e.step || 1;
  return `<div class="steps">
      <span class="step-pill ${step === 1 ? "on" : ""}">1. Folder</span>
      <span class="step-pill ${step === 2 ? "on" : ""}">2. Repository</span>
      <span class="step-pill ${step === 3 ? "on" : ""}">3. Ignore rules</span>
      <span class="step-pill ${step === 4 ? "on" : ""}">4. Review</span>
    </div>
    ${step === 1 ? renderStepFolder(e) : ""}
    ${step === 2 ? renderStepRepo(e) : ""}
    ${step === 3 ? renderStepIgnore(e) : ""}
    ${step === 4 ? renderStepReview(e) : ""}
    <div class="row">
      ${step > 1 ? `<button class="btn ghost" data-action="step" data-step="${step - 1}">Back</button>` : ""}
      ${step < 4 ? `<button class="btn" data-action="step" data-step="${step + 1}">Next</button>` : `<button class="btn ok" data-action="save">Save mapping</button>`}
      <button class="btn ghost" data-action="cancel">Cancel</button>
    </div>`;
}

function renderStepFolder(e) {
  const browser = state.browser;
  const entries = (browser?.entries || []).filter((item) => item.is_dir);
  return `<div class="card">
    <label class="field">Display name
      <input type="text" data-field="name" value="${esc(e.name)}" placeholder="ESPHome">
    </label>
    <label class="field">Selected folder
      <input type="text" data-field="local_path" value="${esc(e.local_path)}" placeholder="homeassistant/esphome">
    </label>
    <div class="row"><button class="btn ghost" data-action="browse" data-path="${esc(e.local_path || "")}">Open file browser</button></div>
    ${
      browser
        ? `<div style="margin-top:16px">
        <div class="crumbs">${crumbs(browser.path || "")}</div>
        <div class="list">
          ${
            entries.length
              ? entries
                  .map(
                    (item) => `<div class="item" data-action="openDir" data-path="${esc(item.path)}">
                <span>📁</span><span class="grow">${esc(item.name)}</span>
                <button class="btn ghost" data-action="pickFolder" data-path="${esc(item.path)}">Select</button>
              </div>`
                  )
                  .join("")
              : `<div class="item"><span class="meta">No subfolders</span></div>`
          }
        </div>
        <div class="row"><button class="btn" data-action="pickFolder" data-path="${esc(browser.path || "")}">Select this folder</button></div>
      </div>`
        : ""
    }
  </div>`;
}

function renderStepRepo(e) {
  const query = (state.repoQuery || "").toLowerCase();
  const repos = (state.repos || []).filter((repo) => {
    if (!query) return true;
    return (
      (repo.full_name || "").toLowerCase().includes(query) ||
      (repo.description || "").toLowerCase().includes(query)
    );
  });
  return `<div class="card">
    <label class="field">Repository (owner/name)
      <input type="text" data-field="repository" value="${esc(e.repository)}" placeholder="username/ha-esphome">
    </label>
    <label class="field">Branch
      <input type="text" data-field="branch" list="gs-branches" value="${esc(e.branch)}" placeholder="main">
      <datalist id="gs-branches">${(state.branches.length ? state.branches : ["main"])
        .map((name) => `<option value="${esc(name)}">`)
        .join("")}</datalist>
    </label>
    <label class="field">Optional path inside the repo
      <input type="text" data-field="repo_path" value="${esc(e.repo_path)}" placeholder="leave empty to use the repo root">
    </label>
    <label class="field">Search your GitHub repositories
      <input type="text" data-action="repoQuery" value="${esc(state.repoQuery)}" placeholder="Filter by name">
    </label>
    <div class="list">
      ${
        state.repos == null
          ? `<div class="item"><span class="meta">Open this step to load repositories.</span></div>`
          : repos
              .slice(0, 80)
              .map(
                (repo) => `<div class="item" data-action="pickRepo" data-repo="${esc(repo.full_name)}" data-branch="${esc(repo.default_branch)}">
            <span>${repo.private ? "🔒" : "📦"}</span>
            <span class="grow">${esc(repo.full_name)}<div class="meta">${esc(repo.description || repo.default_branch)}</div></span>
          </div>`
              )
              .join("") || `<div class="item"><span class="meta">No repositories matched.</span></div>`
      }
    </div>
  </div>`;
}

function renderStepIgnore(e) {
  const side = state.ignoreSide;
  const field = side === "download" ? "ignore_download" : "ignore_upload";
  const preview = state.preview;
  const presets = Object.entries(state.presets || {})
    .map(
      ([key, preset]) =>
        `<button class="chip" data-action="preset" data-preset="${esc(key)}">${esc(preset.label)}</button>`
    )
    .join("");
  return `<div class="card">
    <p class="meta">Patterns use gitignore syntax. Checked files will be ${side === "download" ? "downloaded" : "uploaded"}; uncheck a file to exclude it.</p>
    <div class="row">
      <button class="btn ${side === "upload" ? "" : "ghost"}" data-action="ignoreSide" data-side="upload">Upload ignore</button>
      <button class="btn ${side === "download" ? "" : "ghost"}" data-action="ignoreSide" data-side="download">Download ignore</button>
      <button class="btn ghost" data-action="preview">Refresh preview</button>
    </div>
    <div class="chips">${presets}</div>
    <div class="split">
      <label class="field">${side === "download" ? "Download" : "Upload"} ignore patterns
        <textarea data-field="${field}">${esc(e[field] || "")}</textarea>
      </label>
      <div>
        ${
          preview
            ? `<div class="stats">
                <div class="stat"><b>${preview.included_count}</b><span>included (${bytes(preview.included_size)})</span></div>
                <div class="stat"><b>${preview.excluded_count}</b><span>ignored</span></div>
              </div>
              <div class="list">
                ${(preview.included || [])
                  .slice(0, 200)
                  .map(
                    (file) => `<label class="file">
                    <input type="checkbox" checked data-toggle-path="${esc(file.path)}">
                    <span class="grow">${esc(file.path)}</span>
                    <span class="meta">${bytes(file.size)}</span>
                  </label>`
                  )
                  .join("")}
                ${(preview.excluded || [])
                  .filter((file) => !file.is_dir)
                  .slice(0, 80)
                  .map(
                    (file) => `<label class="file ex">
                    <input type="checkbox" data-toggle-path="${esc(file.path)}">
                    <span class="grow">${esc(file.path)}</span>
                    <span class="meta">${esc(file.pattern || "")}</span>
                  </label>`
                  )
                  .join("")}
              </div>`
            : `<p class="meta">Choose a folder, then refresh preview.</p>`
        }
      </div>
    </div>
  </div>`;
}

function renderStepReview(e) {
  return `<div class="card">
    <h3>${esc(e.name || e.local_path || "New mapping")}</h3>
    <div class="meta">
      Local: <code>${esc(e.local_path || "—")}</code><br>
      GitHub: <strong>${esc(e.repository || "—")}</strong> @ ${esc(e.branch || "main")}
      ${e.repo_path ? `<br>Repo path: ${esc(e.repo_path)}` : ""}
    </div>
    <label class="field" style="margin-top:16px">Commit message template
      <input type="text" data-field="commit_message" value="${esc(e.commit_message)}" placeholder="chore(ha): sync {name} from Home Assistant">
    </label>
    <p class="meta">Placeholders: {name} {folder} {repository} {timestamp}</p>
    <label class="field"><input type="checkbox" data-field-bool="auto_sync" ${e.auto_sync ? "checked" : ""}> Enable automatic sync</label>
    <label class="field">Interval
      <select data-field="auto_interval_minutes">
        ${[15, 60, 360, 1440].map((n) => `<option value="${n}" ${Number(e.auto_interval_minutes) === n ? "selected" : ""}>${n === 1440 ? "Daily" : n === 360 ? "Every 6 hours" : n === 60 ? "Hourly" : "Every 15 minutes"}</option>`).join("")}
      </select>
    </label>
    <label class="field">Automatic action
      <select data-field="auto_direction">
        <option value="upload" ${e.auto_direction === "upload" ? "selected" : ""}>Upload</option>
        <option value="download" ${e.auto_direction === "download" ? "selected" : ""}>Download</option>
        <option value="check" ${e.auto_direction === "check" ? "selected" : ""}>Check only (notify if changes)</option>
      </select>
    </label>
  </div>`;
}

function renderDiff() {
  const d = state.diff;
  if (!d) return "";
  const conflictPaths = new Set((d.conflicts || []).map((f) => f.path));
  const rows = [
    ...(d.added || []).map((f) => ({ ...f, kind: "add", label: "local only" })),
    ...(d.modified || [])
      .filter((f) => !conflictPaths.has(f.path))
      .map((f) => ({ ...f, kind: "mod", label: "changed" })),
    ...(d.removed_locally || []).map((f) => ({ ...f, kind: "del", label: "remote only" })),
    ...(d.conflicts || []).map((f) => ({ ...f, kind: "conflict", label: "conflict" })),
  ];
  return `<div class="card">
    <h3>Updates — ${esc(d.repository)} @ ${esc(d.branch)}</h3>
    <div class="stats">
      <div class="stat"><b>${d.upload_count}</b><span>would upload</span></div>
      <div class="stat"><b>${d.download_count}</b><span>would download</span></div>
      <div class="stat"><b>${d.unchanged}</b><span>unchanged</span></div>
      <div class="stat"><b>${(d.conflicts || []).length}</b><span>conflicts</span></div>
    </div>
    ${d.empty_repo ? `<div class="banner">The remote branch is empty. Upload will create the first commit.</div>` : ""}
    <table class="diff">
      <thead><tr><th>File</th><th>Status</th><th>Size</th></tr></thead>
      <tbody>
        ${
          rows.length
            ? rows
                .slice(0, 400)
                .map(
                  (row) => `<tr>
                  <td>${esc(row.path)}</td>
                  <td><span class="tag ${row.kind}">${esc(row.label)}</span></td>
                  <td class="meta">${bytes(row.size)}</td>
                </tr>`
                )
                .join("")
            : `<tr><td colspan="3" class="meta">Local and remote match (for files that are not ignored).</td></tr>`
        }
      </tbody>
    </table>
    <div class="row">
      <button class="btn ok" data-action="upload" data-id="${esc(d.mapping_id)}">Upload</button>
      <button class="btn" data-action="download" data-id="${esc(d.mapping_id)}">Download</button>
      <button class="btn ghost" data-action="backDiff">Back</button>
    </div>
  </div>`;
}

function renderSettings() {
  const s = state.status || {};
  const oauth = s.oauth || {};
  const device = state.oauthDevice;
  return `${renderOauthCard(oauth, device)}
  <div class="card" style="margin-top:16px">
    <h3>GitHub connection (personal access token)</h3>
    <div class="meta">
      ${s.configured ? `Signed in as <strong>@${esc(s.username)}</strong>` : "Not configured"}<br>
      API: ${esc(s.api_base || "https://api.github.com")}<br>
      Mounts: ${esc((s.roots || []).join(", ") || "none")}<br>
      Mappings: ${s.mapping_count ?? state.mappings.length}
    </div>
    <label class="field" style="margin-top:16px">Personal access token
      <input type="password" data-field-global="tokenDraft" value="${esc(state.tokenDraft)}" placeholder="${s.configured ? "••••••••  (paste to replace)" : "ghp_…"}">
    </label>
    <label class="field">GitHub API URL
      <input type="text" data-field-global="apiDraft" value="${esc(state.apiDraft)}" placeholder="https://api.github.com">
    </label>
    <div class="row">
      <button class="btn" data-action="saveToken">Save token</button>
      ${s.configured ? `<button class="btn ghost" data-action="clearToken">Disconnect</button>` : ""}
    </div>
    <p class="meta" style="margin-top:12px">Fine-grained: Contents Read and write. Classic: <code>repo</code>. The token is stored in this app’s <code>/data</code> volume and is never sent back to the browser.</p>
  </div>
  <div class="card" style="margin-top:16px">
    <h3>How sync works</h3>
    <div class="meta">
      <strong>Check for updates</strong> compares git blob hashes. Nothing is written.<br>
      <strong>Upload</strong> commits local files (minus upload-ignore) to the mapped branch.<br>
      <strong>Download</strong> writes remote files (minus download-ignore) into the local folder.<br>
      Each mapping can target a different repository. File access is limited to folders Home Assistant mounted into this app.
    </div>
  </div>
  ${renderAppUpdates()}`;
}

function renderOauthCard(oauth, device) {
  const builtin = oauth.builtin_device_flow !== false;
  return `<div class="card oauth-card">
    <h3>Connect with GitHub</h3>
    <p class="meta">One-click login — no OAuth App to create and no token to paste. Press the button, open the GitHub link, and enter the short code. This uses the public GitHub CLI OAuth client, the same zero-config flow as the Home Assistant Version Control app.</p>
    ${builtin ? "" : `<p class="meta" style="color:var(--warn)">GitHub Enterprise: the built-in client only works on github.com. Save your own OAuth App client ID under Advanced, or use a personal access token.</p>`}
    <label class="field">Permission scope
      <select data-field-global="oauthScopeDraft">
        <option value="repo" ${state.oauthScopeDraft === "repo" ? "selected" : ""}>Private and public repositories (repo)</option>
        <option value="public_repo" ${state.oauthScopeDraft === "public_repo" ? "selected" : ""}>Public repositories only (public_repo)</option>
      </select>
    </label>
    <div class="row">
      <button class="btn" data-action="deviceAuth">Connect with GitHub</button>
    </div>
    ${device ? `<div class="oauth-device"><strong>Waiting for GitHub approval</strong><p>Open <a href="${esc(device.verification_uri_complete || device.verification_uri)}" target="_blank" rel="noopener">${esc(device.verification_uri)}</a> and enter <code>${esc(device.user_code)}</code>.</p><p class="meta">This page checks automatically. The code expires in about ${Math.ceil(Number(device.expires_in || 900) / 60)} minutes.</p><button class="btn ghost" data-action="cancelDevice">Cancel</button></div>` : ""}
    <details class="advanced">
      <summary>Advanced: your own OAuth App (browser login, GitHub Enterprise)</summary>
      <p class="meta" style="margin-top:10px">Optional. A custom client ID takes precedence over the built-in one for device login, and is required for browser login and GitHub Enterprise.</p>
      <div class="oauth-grid">
        <label class="field">OAuth App client ID
          <input type="text" data-field-global="oauthClientIdDraft" value="${esc(state.oauthClientIdDraft)}" placeholder="Iv1.…">
        </label>
        <label class="field">Client secret <span class="meta">${oauth.client_secret_configured ? "(saved)" : "(required for web login)"}</span>
          <input type="password" data-field-global="oauthClientSecretDraft" value="${esc(state.oauthClientSecretDraft)}" placeholder="${oauth.client_secret_configured ? "••••••••  (leave blank to keep)" : "enter secret"}">
        </label>
      </div>
      <label class="field">Web OAuth callback URL
        <input type="text" data-field-global="oauthRedirectDraft" value="${esc(state.oauthRedirectDraft)}" placeholder="${esc(callbackUrl())}">
      </label>
      <div class="row">
        <button class="btn ghost" data-action="useCallback">Use this app’s callback URL</button>
        <button class="btn ghost" data-action="saveOAuth">Save authorization settings</button>
        <button class="btn" data-action="webAuth">Authorize in browser</button>
      </div>
      <p class="meta" style="margin-top:12px">The OAuth client secret, temporary authorization codes, and final access token stay on the app server and are never returned to the browser. Browser login requires registering the exact callback URL in your OAuth App.</p>
    </details>
  </div>`;
}

function renderAppUpdates() {
  const up = state.updates || {};
  const current = up.current_version || state.status?.version || "unknown";
  const canUpdate = Boolean(up.update_available && up.source === "supervisor");
  const sourceLabel =
    up.source === "supervisor"
      ? "Home Assistant App store"
      : up.source === "github"
        ? "GitHub releases"
        : "not checked yet";
  return `<div class="card" style="margin-top:16px">
    <h3>App updates</h3>
    <div class="meta">
      Current: <strong>v${esc(current)}</strong>${up.latest_version ? ` · Latest: <strong>v${esc(up.latest_version)}</strong>` : ""}<br>
      Source: ${esc(sourceLabel)}${up.checked_at ? ` · Checked ${esc(relTime(up.checked_at))}` : ""}
      ${up.error ? `<br><span style="color:var(--err)">${esc(up.error)}</span>` : ""}
    </div>
    ${
      up.update_available
        ? canUpdate
          ? `<div class="row"><button class="btn ok" data-action="updateNow">Update to v${esc(up.latest_version)} now</button><button class="btn ghost" data-action="checkUpdates">Check again</button></div>
      <p class="meta" style="margin-top:10px">The update is installed by Home Assistant and the app restarts automatically. This sidebar briefly disconnects and returns on its own.</p>`
          : `<div class="row"><button class="btn ghost" data-action="checkUpdates">Check again</button></div>
      <p class="meta" style="margin-top:10px">In-app updates need the Home Assistant Supervisor (App store). Update this app from its install source instead.</p>`
        : `<div class="row"><button class="btn ghost" data-action="checkUpdates">Check for app updates</button></div>
      <p class="meta" style="margin-top:10px">${
        up.latest_version
          ? `You have the latest version (v${esc(current)}).`
          : "Checks run every 30 minutes in the background. The button performs an immediate check."
      }</p>`
    }
  </div>`;
}

function render() {
  const s = state;
  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="wrap">
      <header class="app">
        <div class="brand">
          <img src="assets/icon.png" alt="" width="32" height="32">
          <h1>GitHub Sync</h1>
        </div>
        ${s.status?.username ? `<span class="user-chip">@${esc(s.status.username)}</span>` : ""}
        ${s.status?.version ? `<span class="user-chip" title="Installed version of this app">v${esc(s.status.version)}</span>` : ""}
        <button class="icon-btn" data-action="refresh" title="Refresh">↻</button>
      </header>
      <nav class="tabs">
        <button class="tab ${s.view !== "settings" ? "active" : ""}" data-action="tab" data-view="list">Mappings</button>
        <button class="tab ${s.view === "settings" ? "active" : ""}" data-action="tab" data-view="settings">Settings</button>
      </nav>
      <main>
        ${s.error ? `<div class="banner error">${esc(s.error)}</div>` : ""}
        ${renderUpdateBanner()}
        ${s.view === "settings" ? renderSettings() : ""}
        ${s.view === "list" ? renderList() : ""}
        ${s.view === "editor" ? renderEditor() : ""}
        ${s.view === "diff" ? renderDiff() : ""}
      </main>
      ${s.toast ? `<div class="toast">${esc(s.toast)}</div>` : ""}
      ${s.busy ? `<div class="busy"><div><div class="spinner"></div><p class="meta" style="text-align:center;margin-top:12px">${esc(s.busy)}</p></div></div>` : ""}
      ${
        s.updating
          ? `<div class="busy updating"><div><div class="spinner"></div><p class="meta" style="text-align:center;margin-top:12px">Updating GitHub Sync…<br>The app restarts with the new version automatically.<br>If this stalls, close and reopen the panel.</p></div></div>`
          : ""
      }
      ${
        s.confirm
          ? `<div class="overlay"><div class="dialog">
              <h2>${esc(s.confirm.title)}</h2>
              <p class="meta">${esc(s.confirm.body)}</p>
              ${s.confirm.next?.type === "download" ? `<label class="confirm-option"><input type="checkbox" data-confirm-field="delete_extras" ${s.confirm.delete_extras ? "checked" : ""}> Delete local files that are not present in GitHub</label><p class="warning-text">This cannot be undone from the app. Ignored files are always protected.</p>` : ""}
              <div class="row">
                <button class="btn ${s.confirm.danger ? "danger" : "ok"}" data-action="confirmOk">${esc(s.confirm.ok || "Confirm")}</button>
                <button class="btn ghost" data-action="confirmCancel">Cancel</button>
              </div>
            </div></div>`
          : ""
      }
    </div>`;
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "repoQuery") return;
  onAction(action, el);
});

document.addEventListener("input", (ev) => {
  const field = ev.target.dataset.field;
  if (field && state.editor) state.editor[field] = ev.target.value;
  if (ev.target.dataset.fieldGlobal) state[ev.target.dataset.fieldGlobal] = ev.target.value;
  if (ev.target.dataset.action === "repoQuery") {
    state.repoQuery = ev.target.value;
    render();
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.dataset.field && state.editor) {
    state.editor[ev.target.dataset.field] = ev.target.value;
  }
  if (ev.target.dataset.fieldGlobal) {
    state[ev.target.dataset.fieldGlobal] = ev.target.value;
  }
  if (ev.target.dataset.fieldBool && state.editor) {
    state.editor[ev.target.dataset.fieldBool] = ev.target.checked;
  }
  if (ev.target.dataset.confirmField && state.confirm) {
    state.confirm[ev.target.dataset.confirmField] = ev.target.checked;
    render();
    return;
  }
  const toggle = ev.target.dataset.togglePath;
  if (!toggle || !state.editor) return;
  const side = state.ignoreSide === "download" ? "ignore_download" : "ignore_upload";
  const current = state.editor[side] || "";
  const lines = current.split("\n").map((l) => l.trimEnd());
  if (ev.target.checked) {
    state.editor[side] = lines.filter((l) => l !== toggle && l !== toggle + "/").join("\n");
  } else if (!lines.includes(toggle) && !lines.includes(toggle + "/")) {
    state.editor[side] = `${current.replace(/\s*$/, "")}\n${toggle}`.trim() + "\n";
  }
  preview();
});

refresh();
