'use strict';

// Headless contract test for preload.js: it must expose exactly the five
// window.connectr methods and map each 1:1 onto its IPC channel.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

function loadPreload() {
  const invocations = [];
  let exposed = null;
  const stub = {
    contextBridge: {
      exposeInMainWorld(key, api) {
        assert.strictEqual(key, 'connectr');
        exposed = api;
      },
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        invocations.push({ channel, args });
        return Promise.resolve(null);
      },
    },
  };

  const preloadPath = path.join(__dirname, '..', 'preload.js');
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    request === 'electron' ? stub : originalLoad(request, parent, isMain);
  try {
    delete require.cache[require.resolve(preloadPath)];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
  }
  return { api: exposed, invocations };
}

test('exposes exactly the contract methods on window.connectr', () => {
  const { api } = loadPreload();
  assert.deepStrictEqual(Object.keys(api).sort(), [
    'addProject',
    'createProject',
    'detectTools',
    'goHome',
    'listProjects',
    'openProject',
    'pickFolder',
    'signIn',
  ]);
  for (const key of Object.keys(api)) assert.strictEqual(typeof api[key], 'function');
});

test('each method maps 1:1 onto its IPC channel, forwarding the path argument', async () => {
  const { api, invocations } = loadPreload();
  const spaced = 'C:\\Users\\me\\My Projects\\app one';

  await api.listProjects();
  await api.addProject(spaced);
  await api.pickFolder();
  await api.openProject(spaced);
  await api.goHome();
  await api.detectTools(spaced);
  await api.signIn('codex login');
  await api.createProject({ dir: spaced, tools: ['codex'], mode: 'auto' });

  assert.deepStrictEqual(invocations, [
    { channel: 'projects:list', args: [] },
    { channel: 'projects:add', args: [spaced] },
    { channel: 'projects:pickFolder', args: [] },
    { channel: 'project:open', args: [spaced, undefined] },
    { channel: 'project:home', args: [] },
    { channel: 'tools:detect', args: [spaced] },
    { channel: 'tools:signIn', args: ['codex login'] },
    { channel: 'project:create', args: [{ dir: spaced, tools: ['codex'], mode: 'auto' }] },
  ]);
});

test('leaks no node APIs to the renderer', () => {
  const { api } = loadPreload();
  const source = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'preload.js'),
    'utf8'
  );
  // Only electron is required, and only contextBridge/ipcRenderer are used.
  assert.deepStrictEqual(source.match(/require\((['"])(.*?)\1\)/g), ["require('electron')"]);
  for (const forbidden of ['process', 'require', 'Buffer', '__dirname']) {
    assert.ok(!(forbidden in api), `${forbidden} must not be exposed`);
  }
  for (const value of Object.values(api)) {
    assert.ok(!(value && value.constructor === Object), 'no raw objects crossing the bridge');
  }
});
