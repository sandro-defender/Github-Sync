// Lightweight frontend request/render regressions; no browser or npm deps needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function app() {
  const root = { innerHTML: '' };
  const tokenField = { value: '' };
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: id => id === 'github-token' ? tokenField : root, addEventListener() {} },
    console,
    navigator: { clipboard: { writeText: async () => {} } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    localStorage: { getItem() { return null; } },
    fetch: async (url, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, body });
      let data = {};
      if (url === 'api/oauth/device/start') data = { flow_id: 'flow', user_code: 'CODE', verification_uri: 'https://github.com/login/device' };
      if (url === 'api/download') data = { dry_run: true, direction: 'download', actions: [], create_count: 0, update_count: 0, delete_count: 0, unchanged: 1, skipped: 0 };
      return { ok: true, text: async () => JSON.stringify(data) };
    },
  });
  const source = fs.readFileSync('github_sync/app/static/app.js', 'utf8').replace(/refresh\(\);\s*$/, '');
  vm.runInContext(source, context);
  return { root, tokenField, calls, run: code => vm.runInContext(code, context) };
}

test('access dialog is explicit about app limits and freezes selected policy into start request', async () => {
  const a = app();
  a.run('openAuthSetup()');
  assert.match(a.root.innerHTML, /NOT only to the repositories/);
  assert.equal(a.run('state.authSetup.mode'), 'read');
  a.run(`state.authSetup.repositories = 'owner/repo\\nowner/other'; state.authSetup.scope = 'repo'`);
  await a.run('startDeviceAuth()');
  assert.deepEqual(a.calls[0], { url: 'api/oauth/device/start', body: { scope: 'repo', access: { mode: 'read', repositories: ['owner/repo', 'owner/other'] } } });
  assert.equal(a.run('state.authSetup'), null);
  assert.match(a.root.innerHTML, /CODE/);
});

test('fine-grained token field clears and the secret never enters UI state', async () => {
  const a = app();
  a.run('openAuthSetup()');
  a.tokenField.value = 'github_pat_test_only';
  await a.run('connectToken()');
  assert.equal(a.tokenField.value, '');
  assert.equal(a.calls[0].body.token, 'github_pat_test_only');
  assert.ok(!a.run('JSON.stringify(state)').includes('github_pat_test_only'));
});

test('dry run sends strict booleans and never follows preview with a real operation', async () => {
  const a = app();
  a.run(`state.confirm = { next: { type: 'download', id: 'one' }, delete_extras: true }`);
  await a.run('previewSync()');
  assert.deepEqual(a.calls, [{ url: 'api/download', body: { mapping_id: 'one', dry_run: true, delete_extras: true } }]);
  assert.match(a.root.innerHTML, /Dry run/);
  assert.match(a.root.innerHTML, /No files, GitHub objects or sync history were changed/);
  assert.equal(a.run('state.confirm'), null);
});

test('update failures and fallback releases never claim a verified install', () => {
  const a = app();
  a.run(`state.updates = { error: 'Offline', latest_version: '9.9.9' }; state.view = 'settings'; render()`);
  assert.match(a.root.innerHTML, /Could not verify updates/);
  assert.ok(!a.root.innerHTML.includes('You have the latest version'));
  a.run(`state.updates = { source: 'github', update_available: true, latest_version: '9.9.9' }; render()`);
  assert.ok(!a.root.innerHTML.includes('data-action="updateNow"'));
});

test('dry-run filenames are HTML escaped', () => {
  const a = app();
  const html = a.run(`renderDryRun({ direction: 'upload', actions: [{ path: '<img src=x>', action: 'delete' }] })`);
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /&lt;img src=x&gt;/);
});
