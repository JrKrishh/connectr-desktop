'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { buildMenuTemplate, installMenu, MAX_RECENT } = require('../src/menu')

function find (template, label) {
  for (const top of template) {
    for (const item of top.submenu || []) {
      if (item.label === label) return item
    }
  }
  return null
}

test('every way out of a project has an accelerator', () => {
  const t = buildMenuTemplate()
  assert.strictEqual(find(t, 'All Projects').accelerator, 'CommandOrControl+O')
  assert.strictEqual(find(t, 'Switch Project…').accelerator, 'CommandOrControl+K')
  assert.strictEqual(find(t, 'Close to Tray').accelerator, 'CommandOrControl+W')
  assert.strictEqual(find(t, 'Quit').accelerator, 'CommandOrControl+Q')
  assert.strictEqual(find(t, 'Reload').accelerator, 'CommandOrControl+R')
})

test('menu items call the handlers they are given', () => {
  const calls = []
  const t = buildMenuTemplate({
    onHome: () => calls.push('home'),
    onSwitch: () => calls.push('switch'),
    onReload: () => calls.push('reload'),
    onHide: () => calls.push('hide'),
    onQuit: () => calls.push('quit')
  })
  for (const label of ['All Projects', 'Switch Project…', 'Reload', 'Close to Tray', 'Quit']) {
    find(t, label).click()
  }
  assert.deepStrictEqual(calls.sort(), ['hide', 'home', 'quit', 'reload', 'switch'])
})

test('Recent lists projects and opens the one clicked', () => {
  const opened = []
  const t = buildMenuTemplate({
    projects: [{ name: 'alpha', path: 'E:\\a' }, { name: 'beta', path: 'E:\\b' }],
    onOpenProject: (p) => opened.push(p)
  })
  const recent = find(t, 'Recent').submenu
  assert.deepStrictEqual(recent.map((r) => r.label), ['alpha', 'beta'])
  recent[1].click()
  assert.deepStrictEqual(opened, ['E:\\b'])
})

test('Recent is capped and degrades to a disabled hint when empty', () => {
  const many = Array.from({ length: MAX_RECENT + 5 }, (_, i) => ({ name: 'p' + i, path: '/p' + i }))
  assert.strictEqual(find(buildMenuTemplate({ projects: many }), 'Recent').submenu.length, MAX_RECENT)

  const empty = find(buildMenuTemplate({ projects: [] }), 'Recent').submenu
  assert.strictEqual(empty.length, 1)
  assert.strictEqual(empty[0].enabled, false)
})

test('installMenu sets the application menu and refresh rebuilds it from the registry', () => {
  let built = 0
  let projects = [{ name: 'one', path: '/one' }]
  const Menu = {
    buildFromTemplate: (t) => ({ t }),
    setApplicationMenu: () => { built++ }
  }
  const handle = installMenu(() => null, {
    electron: { Menu },
    registry: { readProjects: () => projects }
  })
  assert.strictEqual(built, 1)

  projects = [{ name: 'one', path: '/one' }, { name: 'two', path: '/two' }]
  handle.refresh()
  assert.strictEqual(built, 2)
})

test('Switch Project asks the page rather than assuming a switcher exists', () => {
  let script = null
  const win = { webContents: { executeJavaScript: (s) => { script = s; return Promise.resolve() } } }
  const Menu = { buildFromTemplate: (t) => t, setApplicationMenu: () => {} }
  let template = null
  installMenu(() => win, {
    electron: { Menu: { ...Menu, buildFromTemplate: (t) => { template = t; return t } } },
    registry: { readProjects: () => [] }
  })
  find(template, 'Switch Project…').click()
  // the picker page has no palette, so the call must be guarded, not assumed
  assert.match(script, /window\.palOpen/)
  assert.match(script, /\?/)
})
