// The application menu: the keyboard is the point. Every route out of a project is an
// accelerator, so you are never stuck inside one. Electron is required lazily (and
// overridable via opts.electron) so this stays requirable - and testable - outside a
// runtime, matching src/tray.js.
'use strict'

const MAX_RECENT = 8

// Pure: takes handlers and a project list, returns a Menu template. Kept separate from
// installMenu so the shape can be asserted without an Electron runtime.
function buildMenuTemplate (opts = {}) {
  const {
    onHome = () => {},
    onSwitch = () => {},
    onReload = () => {},
    onToggleDevTools = () => {},
    onHide = () => {},
    onQuit = () => {},
    onOpenProject = () => {},
    projects = []
  } = opts

  const recent = projects.slice(0, MAX_RECENT).map((p) => ({
    label: p.name,
    toolTip: p.path,
    click: () => onOpenProject(p.path)
  }))

  return [
    {
      label: 'Project',
      submenu: [
        { label: 'All Projects', accelerator: 'CommandOrControl+O', click: () => onHome() },
        { label: 'Switch Project…', accelerator: 'CommandOrControl+K', click: () => onSwitch() },
        { type: 'separator' },
        {
          label: 'Recent',
          submenu: recent.length ? recent : [{ label: 'No projects yet', enabled: false }]
        },
        { type: 'separator' },
        { label: 'Close to Tray', accelerator: 'CommandOrControl+W', click: () => onHide() },
        { label: 'Quit', accelerator: 'CommandOrControl+Q', click: () => onQuit() }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => onReload() },
        { label: 'Toggle Developer Tools', accelerator: 'CommandOrControl+Shift+I', click: () => onToggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]
}

// Ctrl+K is owned by the dashboard page (it renders the switcher), so the menu item just
// asks the page to open it. On the picker there is nothing to switch to, so it no-ops.
function askPageToSwitch (win) {
  if (!win || !win.webContents) return
  win.webContents.executeJavaScript('window.palOpen ? window.palOpen() : null').catch(() => {})
}

function installMenu (getWin, opts = {}) {
  const { Menu } = opts.electron || require('electron')
  const registry = opts.registry || require('./registry')

  const refresh = () => {
    const win = typeof getWin === 'function' ? getWin() : getWin
    const template = buildMenuTemplate({
      projects: registry.readProjects(),
      onHome: opts.onHome,
      onSwitch: () => askPageToSwitch(win),
      onReload: () => win && win.webContents && win.webContents.reload(),
      onToggleDevTools: () => win && win.webContents && win.webContents.toggleDevTools(),
      onHide: () => win && win.hide(),
      onQuit: opts.onQuit,
      onOpenProject: opts.onOpenProject
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  refresh()
  return { refresh }
}

module.exports = { buildMenuTemplate, installMenu, askPageToSwitch, MAX_RECENT }
