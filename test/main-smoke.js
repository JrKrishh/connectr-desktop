// Real-Electron smoke test for main.js - run with: npm run smoke:main
// Deliberately NOT named *.test.js: it opens a real window and spawns the real
// connectr CLI, so it stays out of `npm test` (see PLAN.md).
//
// Covers what the unit tests cannot: that bootstrap() actually runs under
// Electron, that the window is built to spec, that all five channels are live on
// ipcMain, that a real renderer -> preload -> ipcMain -> connectr round trip
// opens a project, and that quitting leaves no listening dashboard behind.
const net = require('node:net');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Requiring main.js boots the app: process.versions.electron is set here.
const { HOME_PAGE, PRELOAD, IPC_CHANNELS } = require('../main');

const failures = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (got ${actual}, want ${expected})`);
  if (!ok) failures.push(label);
};

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });

// A channel that navigates the window cannot deliver its reply: the renderer that
// invoked it is gone by then. So resolve on whichever comes first - the
// navigation (success) or the reply (which only arrives when nothing navigated).
function raceNavigation (win, expression, timeoutMs = 45000) {
  return Promise.race([
    new Promise((resolve) =>
      win.webContents.once('did-finish-load', () => resolve({ navigatedTo: win.webContents.getURL() }))
    ),
    win.webContents.executeJavaScript(expression).then(
      (reply) => ({ reply }),
      (err) => ({ error: String(err && err.message) })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), timeoutMs))
  ]);
}

let openedPort = null;

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  check('bootstrap() created a window under Electron', !!win, true);
  if (!win) return bail('no window to test');

  const [width, height] = win.getSize();
  check('window width', width, 1280);
  check('window height', height, 800);

  await new Promise((resolve) =>
    win.webContents.isLoading() ? win.webContents.once('did-finish-load', resolve) : resolve()
  );

  const prefs = win.webContents.getLastWebPreferences();
  check('contextIsolation', prefs.contextIsolation, true);
  check('nodeIntegration', prefs.nodeIntegration !== true, true);
  // Electron does not always echo `preload` back in getLastWebPreferences, so
  // fall back to proving it ran: window.connectr only exists via the preload.
  if (prefs.preload) {
    check('preload path', path.resolve(prefs.preload), path.resolve(PRELOAD));
  } else {
    check(
      'preload ran (window.connectr exposed)',
      await win.webContents.executeJavaScript('typeof window.connectr'),
      'object'
    );
  }

  // handle() throws on a second registration, which proves the first one is live.
  for (const channel of IPC_CHANNELS) {
    let registered = false;
    try {
      ipcMain.handle(channel, () => {});
    } catch (err) {
      registered = /second handler/i.test(err.message);
    }
    check(`ipcMain handles ${channel}`, registered, true);
  }

  check('launched on the picker', win.webContents.getURL().endsWith('renderer/index.html'), true);
  check('home page file is the picker', HOME_PAGE.endsWith(path.join('renderer', 'index.html')), true);

  // Real round trip: renderer -> preload -> ipcMain -> registry.
  const projects = await win.webContents.executeJavaScript(
    'window.connectr.listProjects()'
  );
  check('projects:list returns an array through preload', Array.isArray(projects), true);

  // Real round trip: renderer -> preload -> ipcMain -> connectr ui child.
  // On success the window navigates, which destroys the renderer context that
  // issued the invoke - so the reply never arrives. Watch for the navigation
  // instead, and let the reply win the race only when it reports a failure.
  const projectDir = path.join(__dirname, '..');
  const openProject = `window.connectr.openProject(${JSON.stringify(projectDir)})`;
  const isDashboard = (url) => /^http:\/\/127\.0\.0\.1:\d+/.test(url || '');

  const open = await raceNavigation(win, openProject);
  console.log('# project:open ->', JSON.stringify(open));
  check('project:open navigated to the dashboard', isDashboard(open.navigatedTo), true);

  if (open.navigatedTo) {
    openedPort = Number(new URL(open.navigatedTo).port);
    check('dashboard is listening', await canConnect(openedPort), true);

    const home = await raceNavigation(win, 'window.connectr.goHome()');
    console.log('# project:home ->', JSON.stringify(home));
    check('project:home returned to the picker', (home.navigatedTo || '').endsWith('renderer/index.html'), true);
    check('dashboard child was stopped by goHome', await canConnect(openedPort), false);

    // Re-open so the quit path has a live child to clean up.
    const again = await raceNavigation(win, openProject);
    check('re-opening the project works', isDashboard(again.navigatedTo), true);
    if (again.navigatedTo) openedPort = Number(new URL(again.navigatedTo).port);
  }

  app.quit();
}).catch((err) => {
  bail(`smoke script threw - ${err.stack}`);
});

let checkedQuit = false;
app.on('before-quit', (e) => {
  if (checkedQuit) return;
  checkedQuit = true;
  // Hold the quit open: app.quit() tears the process down before an async check
  // can run. main.js's own before-quit (registered first) has already stopped
  // the child, so this only observes the result. app.exit() skips before-quit.
  e.preventDefault();
  setTimeout(async () => {
    if (openedPort) {
      check('no dashboard survives the quit', await canConnect(openedPort), false);
    }
    console.log(failures.length ? `# FAILED: ${failures.join(', ')}` : '# all smoke checks passed');
    app.exit(failures.length ? 1 : 0);
  }, 1500);
});

// Bail out through app.quit() rather than app.exit(): exit() skips before-quit,
// which is where main.js kills the dashboard child - a hard exit leaks it.
function bail(reason) {
  console.log(`# FAILED: ${reason}`);
  failures.push(reason);
  app.quit();
  setTimeout(() => app.exit(1), 5000).unref();
}

setTimeout(() => bail('timed out'), 90000);
