// Electron main process: one window, five IPC channels, and a child server whose
// lifetime is tied to the app's. Electron is required lazily inside bootstrap()
// so this file stays requirable under plain node for the handler-wiring tests.
'use strict';

const path = require('node:path');
const net = require('node:net');

const HOME_PAGE = path.join(__dirname, 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');

// The renderer's whole vocabulary. preload.js must expose exactly these.
const IPC_CHANNELS = [
  'projects:list',
  'projects:add',
  'projects:pickFolder',
  'project:open',
  'project:home',
  'tools:detect',
  'tools:signIn',
  'project:create'
];

// Accepts "--project <path>" and "--project=<path>" anywhere in argv, so one parse
// serves `electron . --project X`, a packaged `ConnectR Desktop.exe --project X`,
// and the argv Windows hands us when a second launch hits the instance lock.
function parseProjectArg(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg === '--project') return argv[i + 1] ? String(argv[i + 1]) : null;
    if (arg.startsWith('--project=')) return arg.slice('--project='.length) || null;
  }
  return null;
}

// serverManager.start() resolves when the child is spawned, not when it listens,
// so loading the url straight away races the dashboard and gets
// ERR_CONNECTION_REFUSED. Poll the port until it accepts a connection.
function waitForPort(port, { timeoutMs = 20000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`the dashboard did not start listening on port ${port}`));
        } else {
          setTimeout(attempt, intervalMs);
        }
      });
    };
    attempt();
  });
}

// Returns { channel: handler } with every Electron touchpoint injected, so the
// map can be built and exercised without an Electron runtime.
function createIpcHandlers({
  registry,
  serverManager,
  dialog,
  getWindow,
  waitForServer = waitForPort,
  onProjectsChanged = () => {},
  onboard = require('./src/onboard')
}) {
  return {
    'projects:list': () => registry.readProjects(),

    'projects:add': (_event, dirPath) => {
      const projects = registry.addProject(dirPath);
      onProjectsChanged(); // a new project should appear under the menu's Recent list
      return projects;
    },

    'projects:pickFolder': async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
      return result.filePaths[0];
    },

    // Start the dashboard for this project, then point the window at it. On any
    // failure the child is stopped again and the window stays on the picker -
    // the renderer shows the error. Note the { ok: true } reply is only ever
    // seen by a caller that survives the navigation; the picker does not, which
    // is fine - success looks like the dashboard appearing.
    'project:open': async (_event, projectPath, intent) => {
      try {
        const { port, url } = await serverManager.start(projectPath);
        await waitForServer(port);
        // Onboarding can pass an intent; kick planning off before the window navigates so
        // the board is already filling in by the time the user sees it.
        if (intent) await onboard.postPlan(port, intent);
        await getWindow().loadURL(url);
        return { ok: true, url };
      } catch (err) {
        serverManager.stop();
        return { ok: false, error: err.message };
      }
    },

    // Onboarding. Detection and creation both shell out to the connectr CLI, and sign-in
    // opens the tool's own login in a terminal - no credential is ever handled here.
    'tools:detect': async (_event, dir) => {
      try {
        return { ok: true, tools: await onboard.detectTools({ cwd: dir || undefined }) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'tools:signIn': (_event, command) => onboard.signIn(command),

    'project:create': async (_event, opts = {}) => {
      try {
        const made = await onboard.createProject(opts.dir, opts.tools, opts.mode);
        registry.addProject(made.dir);
        onProjectsChanged();
        return { ok: true, ...made };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'project:home': async () => {
      serverManager.stop();
      await getWindow().loadFile(HOME_PAGE);
      return { ok: true };
    }
  };
}

function bootstrap() {
  const { app, BrowserWindow, ipcMain, dialog } = require('electron');
  const registry = require('./src/registry');
  const { createServerManager } = require('./src/server');
  const { createTray, setupSingleInstance } = require('./src/tray');
  const { installMenu } = require('./src/menu');

  const serverManager = createServerManager();
  let win = null;
  let trayHandle = null;
  let menuHandle = null;

  const handlers = createIpcHandlers({
    registry,
    serverManager,
    dialog,
    getWindow: () => win,
    onProjectsChanged: () => menuHandle && menuHandle.refresh()
  });

  // Must precede whenReady; a second launch focuses the window we already have,
  // and switches it to the project that launch named.
  const singleInstance = setupSingleInstance(() => win, {
    onSecondInstance: (argv) => {
      const project = parseProjectArg(argv);
      if (project) handlers['project:open'](null, project);
    }
  });
  if (!singleInstance) return;

  app.whenReady().then(() => {
    for (const channel of IPC_CHANNELS) ipcMain.handle(channel, handlers[channel]);

    win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: true,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    // Load the picker first either way: if --project fails to start, the window is
    // already showing somewhere useful rather than a blank frame.
    win.loadFile(HOME_PAGE);

    const startProject = parseProjectArg(process.argv);
    if (startProject) {
      handlers['project:open'](null, startProject).then((result) => {
        if (!result.ok) console.error(`--project ${startProject}: ${result.error}`);
      });
    }

    trayHandle = createTray(win, { onQuit: () => serverManager.stop() });

    // The menu is the app's keyboard surface; rebuild it when the project list changes
    // so Recent stays honest.
    menuHandle = installMenu(() => win, {
      onHome: () => handlers['project:home'](),
      onQuit: () => app.quit(),
      onOpenProject: (p) => handlers['project:open'](null, p)
    });
  });

  // setQuitting lets the close through; both quit hooks stop the child because
  // either one can be the last to run depending on how the quit was triggered.
  app.on('before-quit', () => {
    if (trayHandle) trayHandle.setQuitting(true);
    serverManager.stop();
  });
  app.on('will-quit', () => serverManager.stop());

  // On Windows the tray owns the app's lifetime - closing the window only hides it.
  app.on('window-all-closed', () => {
    if (process.platform !== 'win32') app.quit();
  });
}

// Boot only under Electron; requiring this file from a node:test stays inert.
if (process.versions.electron) bootstrap();

module.exports = { createIpcHandlers, bootstrap, waitForPort, parseProjectArg, IPC_CHANNELS, HOME_PAGE, PRELOAD };
