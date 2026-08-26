'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const net = require('node:net');

const {
  createIpcHandlers,
  waitForPort,
  parseProjectArg,
  IPC_CHANNELS,
  HOME_PAGE,
  PRELOAD
} = require('../main');

test('parseProjectArg reads --project in both spellings, anywhere in argv', () => {
  // packaged: "ConnectR Desktop.exe" --project E:\app
  assert.strictEqual(parseProjectArg(['C:\\app.exe', '--project', 'E:\\app']), 'E:\\app');
  // dev: electron . --project=E:\app
  assert.strictEqual(parseProjectArg(['electron', '.', '--project=E:\\app']), 'E:\\app');
  // other switches ahead of it, and a path containing a space
  assert.strictEqual(parseProjectArg(['app.exe', '--no-sandbox', '--project', 'E:\\a b']), 'E:\\a b');
});

test('parseProjectArg returns null when absent or valueless', () => {
  assert.strictEqual(parseProjectArg([]), null);
  assert.strictEqual(parseProjectArg(undefined), null);
  assert.strictEqual(parseProjectArg(['app.exe']), null);
  assert.strictEqual(parseProjectArg(['app.exe', '--project']), null);
  assert.strictEqual(parseProjectArg(['app.exe', '--project=']), null);
  assert.strictEqual(parseProjectArg(['app.exe', '--projects', 'x']), null);
});

function makeFixture(overrides = {}) {
  const calls = [];
  const win = {
    loadURL: async (url) => calls.push(['loadURL', url]),
    loadFile: async (file) => calls.push(['loadFile', file])
  };
  const deps = {
    registry: {
      readProjects: () => [{ name: 'demo', path: 'C:\\demo' }],
      addProject: (dirPath) => {
        calls.push(['addProject', dirPath]);
        return [{ name: 'demo', path: dirPath }];
      }
    },
    serverManager: {
      start: async (projectPath) => {
        calls.push(['start', projectPath]);
        return { port: 5000, url: 'http://127.0.0.1:5000' };
      },
      stop: () => calls.push(['stop'])
    },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\picked'] }) },
    getWindow: () => win,
    waitForServer: async (port) => calls.push(['waitForServer', port]),
    ...overrides
  };
  return { handlers: createIpcHandlers(deps), calls, win };
}

test('exports exactly the five contract channels', () => {
  assert.deepStrictEqual(IPC_CHANNELS, [
    'projects:list',
    'projects:add',
    'projects:pickFolder',
    'project:open',
    'project:home'
  ]);
});

test('every channel has a function handler', () => {
  const { handlers } = makeFixture();
  assert.deepStrictEqual(Object.keys(handlers).sort(), [...IPC_CHANNELS].sort());
  for (const channel of IPC_CHANNELS) {
    assert.strictEqual(typeof handlers[channel], 'function', `${channel} handler`);
  }
});

test('preload and home page point at the expected files', () => {
  assert.strictEqual(PRELOAD, path.join(__dirname, '..', 'preload.js'));
  assert.strictEqual(HOME_PAGE, path.join(__dirname, '..', 'renderer', 'index.html'));
});

test('projects:list returns the registry contents', async () => {
  const { handlers } = makeFixture();
  assert.deepStrictEqual(await handlers['projects:list'](), [
    { name: 'demo', path: 'C:\\demo' }
  ]);
});

test('projects:add forwards the directory path to the registry', async () => {
  const { handlers, calls } = makeFixture();
  const result = await handlers['projects:add'](null, 'C:\\new project');
  assert.deepStrictEqual(calls, [['addProject', 'C:\\new project']]);
  assert.deepStrictEqual(result, [{ name: 'demo', path: 'C:\\new project' }]);
});

test('projects:pickFolder returns the chosen directory', async () => {
  const { handlers } = makeFixture();
  assert.strictEqual(await handlers['projects:pickFolder'](), 'C:\\picked');
});

test('projects:pickFolder returns null when the dialog is cancelled', async () => {
  const { handlers } = makeFixture({
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  });
  assert.strictEqual(await handlers['projects:pickFolder'](), null);
});

test('project:open starts the server then loads its url', async () => {
  const { handlers, calls } = makeFixture();
  const result = await handlers['project:open'](null, 'C:\\my project');
  assert.deepStrictEqual(result, { ok: true, url: 'http://127.0.0.1:5000' });
  assert.deepStrictEqual(calls, [
    ['start', 'C:\\my project'],
    ['waitForServer', 5000],
    ['loadURL', 'http://127.0.0.1:5000']
  ]);
});

test('project:open reports the error and never navigates when start fails', async () => {
  const stopped = [];
  const { handlers, calls } = makeFixture({
    serverManager: {
      start: async () => {
        const err = new Error('connectr CLI not found on PATH');
        err.code = 'ENOENT';
        throw err;
      },
      stop: () => stopped.push(['stop'])
    }
  });
  const result = await handlers['project:open'](null, 'C:\\missing');
  assert.deepStrictEqual(result, { ok: false, error: 'connectr CLI not found on PATH' });
  assert.ok(!calls.some((c) => c[0] === 'loadURL'), 'window must stay on the picker');
  assert.deepStrictEqual(stopped, [['stop']], 'a failed open cleans up the child');
});

test('project:open reports the error when the window fails to load the url', async () => {
  const { handlers, calls, win } = makeFixture();
  win.loadURL = async () => {
    throw new Error('ERR_CONNECTION_REFUSED');
  };
  const result = await handlers['project:open'](null, 'C:\\demo');
  assert.deepStrictEqual(result, { ok: false, error: 'ERR_CONNECTION_REFUSED' });
  assert.ok(calls.some((c) => c[0] === 'stop'), 'a failed load stops the orphan child');
});

test('project:home stops the server and returns to the picker', async () => {
  const { handlers, calls } = makeFixture();
  const result = await handlers['project:home']();
  assert.deepStrictEqual(result, { ok: true });
  assert.deepStrictEqual(calls, [['stop'], ['loadFile', HOME_PAGE]]);
});

test('switching projects delegates to serverManager.start, which kills the previous child', async () => {
  const started = [];
  const { handlers } = makeFixture({
    serverManager: {
      start: async (p) => {
        started.push(p);
        return { port: 5000 + started.length, url: `http://127.0.0.1:${5000 + started.length}` };
      },
      stop: () => {}
    }
  });
  await handlers['project:open'](null, 'C:\\a');
  await handlers['project:open'](null, 'C:\\b');
  assert.deepStrictEqual(started, ['C:\\a', 'C:\\b']);
});

test('project:open reports the error when the dashboard never starts listening', async () => {
  const { handlers, calls } = makeFixture({
    waitForServer: async () => {
      throw new Error('the dashboard did not start listening on port 5000');
    }
  });
  const result = await handlers['project:open'](null, 'C:\\demo');
  assert.deepStrictEqual(result, {
    ok: false,
    error: 'the dashboard did not start listening on port 5000'
  });
  assert.ok(!calls.some((c) => c[0] === 'loadURL'), 'window must stay on the picker');
  assert.ok(calls.some((c) => c[0] === 'stop'), 'the half-started child is killed');
});

test('waitForPort resolves once something accepts on the port', async () => {
  const server = net.createServer((s) => s.end());
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  await waitForPort(port, { timeoutMs: 2000, intervalMs: 20 });
  await new Promise((resolve) => server.close(resolve));
});

test('waitForPort rejects instead of hanging when nothing ever listens', async () => {
  // Port 1 on loopback: refused immediately and reliably unused.
  await assert.rejects(
    () => waitForPort(1, { timeoutMs: 200, intervalMs: 20 }),
    /did not start listening on port 1/
  );
});
