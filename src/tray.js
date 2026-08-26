// System tray icon, hide-to-tray on window close, and the single-instance lock.
// Electron is required lazily (and overridable via opts.electron) so the module
// stays requirable - and unit testable - outside an Electron runtime.
const path = require('node:path')

const ICON_PATH = path.join(__dirname, '..', 'assets', 'tray.png')

function createTray (win, opts = {}) {
  const { onQuit } = opts
  const { app, Tray, Menu, nativeImage } = opts.electron || require('electron')

  let isQuitting = false

  const showWindow = () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const tray = new Tray(nativeImage.createFromPath(ICON_PATH))
  tray.setToolTip('ConnectR Desktop')

  const refreshMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: win.isVisible() ? 'Hide' : 'Show',
        click: () => { if (win.isVisible()) win.hide(); else showWindow() }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          if (onQuit) onQuit()
          app.quit()
        }
      }
    ]))
  }
  refreshMenu()

  tray.on('double-click', showWindow)
  win.on('show', refreshMenu)
  win.on('hide', refreshMenu)

  // Closing the window hides to tray; only the Quit path (or setQuitting(true)
  // from main.js's before-quit) lets the close through.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  return { tray, setQuitting: (v) => { isQuitting = !!v } }
}

// Must run before app.whenReady(), so the window is passed as a getter.
// Returns false when another instance already holds the lock (app.quit() called).
function setupSingleInstance (getWin, opts = {}) {
  const { app } = opts.electron || require('electron')

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', (_event, argv) => {
    const win = typeof getWin === 'function' ? getWin() : getWin
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    // The second launch's argv is the only thing it can tell us - let the caller
    // act on it (e.g. switch to the project that launch named).
    if (typeof opts.onSecondInstance === 'function') opts.onSecondInstance(argv || [])
  })
  return true
}

module.exports = { createTray, setupSingleInstance, ICON_PATH }
