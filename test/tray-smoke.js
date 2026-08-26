// Real-Electron smoke test for src/tray.js - run with: npm run smoke:tray
// Deliberately NOT named *.test.js: it needs a desktop session, so it stays out
// of `npm test` (see PLAN.md - the Electron window cannot be opened headlessly).
//
// Covers what the unit tests cannot: that a real window close hides to tray, that
// the real tray menu item quits, and that the onQuit cleanup leaves no orphaned
// child process behind. Exits 0 on success, 1 with a FAIL line otherwise.
const electron = require('electron')
const { app, BrowserWindow, Menu } = electron
const { spawn } = require('node:child_process')
const { createTray, setupSingleInstance } = require('../src/tray')

const failures = []
const check = (label, actual, expected) => {
  const ok = actual === expected
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (got ${actual}, want ${expected})`)
  if (!ok) failures.push(label)
}

// Stand-in for the connectr dashboard child that main.js spawns.
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
console.log('# dashboard-stub pid', child.pid)

let win = null
let menu = null
// Captures the built template so the test can invoke the real click handlers.
const injected = {
  ...electron,
  Menu: { buildFromTemplate: (tpl) => { menu = tpl; return Menu.buildFromTemplate(tpl) } }
}

check('single-instance lock acquired', setupSingleInstance(() => win, { electron }), true)

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 400, height: 300 })
  win.loadURL('data:text/html,connectr-tray-smoke')

  createTray(win, { electron: injected, onQuit: () => child.kill() })
  check('menu shape', JSON.stringify(menu.map((i) => i.label || i.type)), '["Hide","separator","Quit"]')

  setTimeout(() => {
    win.close()
    check('close hides to tray instead of destroying', win.isVisible(), false)
    check('menu relabels to Show', menu[0].label, 'Show')

    menu.find((i) => i.label === 'Quit').click()
  }, 1500)
})

let childExited = false
child.on('exit', () => { childExited = true })

app.on('before-quit', (e) => {
  // Hold the quit open, otherwise the process tears down before the child is
  // reaped and the orphan check below never runs. app.exit() skips before-quit.
  e.preventDefault()
  setTimeout(() => {
    check('no orphaned dashboard child after quit', childExited, true)
    console.log(failures.length ? `# FAILED: ${failures.join(', ')}` : '# all smoke checks passed')
    app.exit(failures.length ? 1 : 0)
  }, 1000)
})

setTimeout(() => { console.log('# FAILED: timed out'); app.exit(1) }, 30000)
