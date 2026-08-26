'use strict';

// Real-Electron smoke test for renderer/index.html - run with: npm run smoke:renderer
// Deliberately NOT named *.test.js: it needs a desktop session (see PLAN.md).
// Drives the real page through a fake preload and asserts on the live DOM.
// Exits 0 on success, 1 with FAIL lines otherwise.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const failures = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  if (!ok) failures.push(label);
};

const SPACED = 'C:\\Users\\me\\My Projects\\app one';
const PLAIN = 'C:\\code\\plain';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-fake-preload.js') },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const settle = () => js('new Promise(r => setTimeout(r, 120))');

  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await settle();

    // Empty registry -> friendly empty state, not a blank page.
    check('empty state visible', await js('document.getElementById("empty").hidden'), false);
    check('empty state has text', await js('document.getElementById("empty").textContent.length > 0'), true);
    check('no project rows yet', await js('document.querySelectorAll("#projects li").length'), 0);

    // Browse... fills the input with a path containing spaces.
    await js('document.getElementById("browse").click()');
    await settle();
    check('Browse fills input verbatim', await js('document.getElementById("path-input").value'), SPACED);

    // Submitting adds it and re-renders.
    await js('document.getElementById("add-form").requestSubmit()');
    await settle();
    check('row added', await js('document.querySelectorAll("#projects li").length'), 1);
    check('empty state hidden', await js('document.getElementById("empty").hidden'), true);
    check('path displays with spaces intact', await js('document.querySelector("#projects .path").textContent'), SPACED);
    check('name shown', await js('document.querySelector("#projects .name").textContent'), 'app one');
    check('input cleared', await js('document.getElementById("path-input").value'), '');

    // Add a second, plain path.
    await js(`document.getElementById("path-input").value = ${JSON.stringify(PLAIN)};
              document.getElementById("add-form").requestSubmit()`);
    await settle();
    check('two rows', await js('document.querySelectorAll("#projects li").length'), 2);

    // Clicking the spaced project -> fake preload returns { ok:false }.
    // Assert the "Starting server..." state appears before the result lands.
    // Read the status in the same synchronous turn as the click, otherwise the
    // round trip lets the (already resolved) IPC promise overwrite it first.
    check('shows Starting server... while opening', await js(`(() => {
      document.querySelectorAll("#projects button")[0].click();
      return document.getElementById("status").textContent;
    })()`), 'Starting server...');
    await settle();
    check('error rendered inline', await js('document.getElementById("status").textContent'), 'connectr CLI not found on PATH');
    check('error styled as error', await js('document.getElementById("status").classList.contains("error")'), true);
    check('stayed on the picker', await js('location.pathname.endsWith("/renderer/index.html")'), true);
    check('picker re-enabled after error', await js('document.querySelectorAll("#projects button")[0].disabled'), false);

    // Clicking the ok project -> stays in the starting state (main process navigates).
    await js('document.querySelectorAll("#projects button")[1].click()');
    await settle();
    check('success keeps the starting state', await js('document.getElementById("status").textContent'), 'Starting server...');
    check('no error class on success', await js('document.getElementById("status").classList.contains("error")'), false);
  } catch (err) {
    console.log('FAIL threw:', err && err.message);
    failures.push('exception');
  }

  console.log(failures.length ? `# FAILED: ${failures.join(', ')}` : '# all renderer smoke checks passed');
  app.exit(failures.length ? 1 : 0);
});

setTimeout(() => { console.log('# FAILED: timed out'); app.exit(1); }, 30000);
