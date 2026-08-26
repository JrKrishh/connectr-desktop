const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const { createTray, setupSingleInstance, ICON_PATH } = require('../src/tray')

// --- minimal fake Electron -------------------------------------------------
class Emitter {
  constructor () { this.handlers = {} }
  on (event, fn) { (this.handlers[event] ||= []).push(fn); return this }
  emit (event, ...args) { for (const fn of this.handlers[event] || []) fn(...args) }
}

class FakeWin extends Emitter {
  constructor () { super(); this.visible = true; this.minimized = false; this.focused = 0 }
  isVisible () { return this.visible }
  isMinimized () { return this.minimized }
  restore () { this.minimized = false }
  show () { this.visible = true; this.emit('show') }
  hide () { this.visible = false; this.emit('hide') }
  focus () { this.focused++ }
  // mimics Electron: 'close' listeners may preventDefault to veto the close
  close () {
    const e = { defaultPrevented: false, preventDefault () { this.defaultPrevented = true } }
    this.emit('close', e)
    return !e.defaultPrevented
  }
}

function fakeElectron ({ lock = true } = {}) {
  const state = { menu: null, iconPath: null, tooltip: null, quits: 0, app: null }
  class FakeTray extends Emitter {
    constructor (icon) { super(); state.iconPath = icon }
    setToolTip (t) { state.tooltip = t }
    setContextMenu (m) { state.menu = m }
  }
  const app = new Emitter()
  app.quit = () => { state.quits++ }
  app.requestSingleInstanceLock = () => lock
  state.app = app
  return {
    state,
    electron: {
      app,
      Tray: FakeTray,
      Menu: { buildFromTemplate: (tpl) => tpl },
      nativeImage: { createFromPath: (p) => p }
    }
  }
}

const labels = (menu) => menu.map((i) => i.label || i.type)
const item = (menu, label) => menu.find((i) => i.label === label)

// --- assets ----------------------------------------------------------------
test('assets/tray.png exists and is a real PNG of 16x16 or 32x32', () => {
  const buf = fs.readFileSync(ICON_PATH)
  assert.deepStrictEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  assert.strictEqual(width, height)
  assert.ok([16, 32].includes(width), `expected 16 or 32, got ${width}`)
})

// --- context menu ----------------------------------------------------------
test('builds a tray from assets/tray.png with Show/Hide, separator, Quit', () => {
  const { state, electron } = fakeElectron()
  const win = new FakeWin()
  const { tray } = createTray(win, { electron })

  assert.ok(tray)
  assert.strictEqual(state.iconPath, ICON_PATH)
  assert.deepStrictEqual(labels(state.menu), ['Hide', 'separator', 'Quit'])
})

test('Show/Hide toggles the window and relabels itself', () => {
  const { state, electron } = fakeElectron()
  const win = new FakeWin() // starts visible
  createTray(win, { electron })

  item(state.menu, 'Hide').click()
  assert.strictEqual(win.isVisible(), false)
  assert.deepStrictEqual(labels(state.menu), ['Show', 'separator', 'Quit'])

  item(state.menu, 'Show').click()
  assert.strictEqual(win.isVisible(), true)
  assert.strictEqual(win.focused, 1)
  assert.deepStrictEqual(labels(state.menu), ['Hide', 'separator', 'Quit'])
})

test('Show restores a minimized window', () => {
  const { state, electron } = fakeElectron()
  const win = new FakeWin()
  createTray(win, { electron })

  item(state.menu, 'Hide').click()
  win.minimized = true
  item(state.menu, 'Show').click()
  assert.strictEqual(win.isMinimized(), false)
  assert.strictEqual(win.isVisible(), true)
})

// --- close = hide to tray --------------------------------------------------
test('close is vetoed and hides to tray while not quitting', () => {
  const { electron } = fakeElectron()
  const win = new FakeWin()
  createTray(win, { electron })

  const closed = win.close()
  assert.strictEqual(closed, false, 'close should be prevented')
  assert.strictEqual(win.isVisible(), false, 'window should be hidden instead')
})

test('Quit sets isQuitting then app.quit(), and close is no longer vetoed', () => {
  const { state, electron } = fakeElectron()
  const win = new FakeWin()
  createTray(win, { electron })

  item(state.menu, 'Quit').click()
  assert.strictEqual(state.quits, 1)
  assert.strictEqual(win.close(), true, 'close must pass through after Quit')
})

test('Quit runs the onQuit cleanup hook before app.quit()', () => {
  const { state, electron } = fakeElectron()
  const order = []
  const app = state.app
  app.quit = () => { order.push('quit') }
  const win = new FakeWin()
  createTray(win, { electron, onQuit: () => order.push('onQuit') })

  item(state.menu, 'Quit').click()
  assert.deepStrictEqual(order, ['onQuit', 'quit'])
})

test('setQuitting(true) lets main.js release the close veto too', () => {
  const { electron } = fakeElectron()
  const win = new FakeWin()
  const { setQuitting } = createTray(win, { electron })

  assert.strictEqual(win.close(), false)
  setQuitting(true)
  assert.strictEqual(win.close(), true)
  setQuitting(false)
  assert.strictEqual(win.close(), false)
})

// --- double click ----------------------------------------------------------
test('double-clicking the tray icon shows and focuses the window', () => {
  const { electron } = fakeElectron()
  const win = new FakeWin()
  const { tray } = createTray(win, { electron })

  win.hide()
  win.minimized = true
  tray.emit('double-click')

  assert.strictEqual(win.isVisible(), true)
  assert.strictEqual(win.isMinimized(), false)
  assert.strictEqual(win.focused, 1)
})

// --- single instance -------------------------------------------------------
test('setupSingleInstance quits immediately when the lock is not acquired', () => {
  const { state, electron } = fakeElectron({ lock: false })
  const win = new FakeWin()

  assert.strictEqual(setupSingleInstance(() => win, { electron }), false)
  assert.strictEqual(state.quits, 1)
  assert.deepStrictEqual(state.app.handlers['second-instance'], undefined)
})

test('second-instance restores, shows and focuses the existing window', () => {
  const { state, electron } = fakeElectron({ lock: true })
  const win = new FakeWin()

  assert.strictEqual(setupSingleInstance(() => win, { electron }), true)
  assert.strictEqual(state.quits, 0)

  win.hide()
  win.minimized = true
  state.app.emit('second-instance')

  assert.strictEqual(win.isMinimized(), false)
  assert.strictEqual(win.isVisible(), true)
  assert.strictEqual(win.focused, 1)
})

test('second-instance is a no-op before the window exists', () => {
  const { state, electron } = fakeElectron({ lock: true })
  setupSingleInstance(() => null, { electron })
  assert.doesNotThrow(() => state.app.emit('second-instance'))
})
