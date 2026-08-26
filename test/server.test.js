const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { createServerManager } = require('../src/server')

// Minimal stand-in for a ChildProcess: records kill() so tests can prove the
// previous server died before a new one started.
function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  return child
}

function harness(overrides = {}) {
  const calls = []
  const killed = []
  let pid = 1000
  const deps = {
    spawn(command, args, options) {
      const child = fakeChild((pid += 1))
      calls.push({ command, args, options, child })
      return child
    },
    findFreePort: async () => 41234,
    resolveCli: () => 'C:\\Program Files\\nodejs\\connectr.cmd',
    killTree: (p) => killed.push(p),
    ...overrides
  }
  return { manager: createServerManager(deps), calls, killed }
}

test('start resolves port, url and child, and reports them via current()', async () => {
  const { manager, calls } = harness()
  assert.strictEqual(manager.current(), null)

  const started = await manager.start('E:\\My Projects\\connectr demo')

  assert.strictEqual(started.port, 41234)
  assert.strictEqual(started.url, 'http://127.0.0.1:41234')
  assert.strictEqual(started.child, calls[0].child)
  assert.deepStrictEqual(manager.current(), {
    port: 41234,
    url: 'http://127.0.0.1:41234',
    projectPath: 'E:\\My Projects\\connectr demo'
  })
})

test('project paths containing spaces are passed as cwd and args stay an array', async () => {
  const { manager, calls } = harness()
  await manager.start('E:\\My Projects\\connectr demo')

  const { command, args, options } = calls[0]
  assert.strictEqual(options.cwd, 'E:\\My Projects\\connectr demo')
  assert.ok(Array.isArray(args), 'args must be an array, never a shell string')
  assert.deepStrictEqual(args.slice(-3), ['ui', '--port', '41234'])
  // The command with spaces is one argv element, so no quoting is required.
  assert.ok(!command.includes(' ') || command === process.env.ComSpec)
  assert.ok(
    args.some((a) => a === 'C:\\Program Files\\nodejs\\connectr.cmd') ||
      command === 'C:\\Program Files\\nodejs\\connectr.cmd',
    'the CLI path is a single argv element'
  )
})

test('starting again stops the previous child so only one is ever live', async () => {
  const { manager, calls, killed } = harness()
  const first = await manager.start('E:\\a project')
  const second = await manager.start('E:\\another project')

  assert.strictEqual(calls.length, 2)
  assert.strictEqual(first.child.killed, true)
  assert.strictEqual(second.child.killed, false)
  assert.deepStrictEqual(killed, [first.child.pid])
  assert.strictEqual(manager.current().projectPath, 'E:\\another project')
})

test('stop kills the tree, clears current(), and is safe when nothing runs', async () => {
  const { manager, killed } = harness()
  manager.stop() // no-op, must not throw

  const started = await manager.start('E:\\some project')
  manager.stop()

  assert.deepStrictEqual(killed, [started.child.pid])
  assert.strictEqual(started.child.killed, true)
  assert.strictEqual(manager.current(), null)

  manager.stop() // idempotent
  assert.deepStrictEqual(killed, [started.child.pid])
})

test('stop survives a kill that throws, so app quit is never blocked', async () => {
  const { manager } = harness({
    killTree: () => {
      throw new Error('taskkill: process not found')
    }
  })
  await manager.start('E:\\some project')

  assert.doesNotThrow(() => manager.stop())
  assert.strictEqual(manager.current(), null)
})

test('a missing CLI rejects with ENOENT instead of hanging', async () => {
  const { manager, calls } = harness({ resolveCli: () => null })

  await assert.rejects(() => manager.start('E:\\some project'), (err) => {
    assert.strictEqual(err.code, 'ENOENT')
    assert.match(err.message, /connectr/)
    return true
  })
  assert.strictEqual(calls.length, 0)
  assert.strictEqual(manager.current(), null)
})

test('a child that dies on its own clears current()', async () => {
  const { manager } = harness()
  const started = await manager.start('E:\\some project')

  started.child.emit('exit', 1, null)
  assert.strictEqual(manager.current(), null)
})

test('a child error event is handled rather than thrown process-wide', async () => {
  const { manager } = harness()
  const started = await manager.start('E:\\some project')

  assert.doesNotThrow(() => started.child.emit('error', new Error('boom')))
  assert.strictEqual(manager.current(), null)
})

// Integration: no injected spawn, a real .cmd shim on PATH, spaces in both the
// CLI directory and the project directory. This is the case that broke first -
// `cmd /s /c` strips the quotes Node puts around a path containing a space.
test('really spawns a CLI whose path and cwd both contain spaces', { skip: process.platform !== 'win32' }, async () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'connectr-server-'))
  const binDir = path.join(base, 'bin (x86) dir')
  const projectDir = path.join(base, 'My Project Dir')
  fs.mkdirSync(binDir)
  fs.mkdirSync(projectDir)
  fs.writeFileSync(
    path.join(binDir, 'connectr.cmd'),
    '@echo off\r\necho ARGS=%1,%2,%3\r\necho CWD=%CD%\r\n'
  )

  const previousPath = process.env.PATH
  process.env.PATH = binDir + path.delimiter + previousPath
  try {
    const manager = createServerManager({
      findFreePort: async () => 45678,
      spawn: (command, args, options) =>
        require('node:child_process').spawn(command, args, { ...options, stdio: 'pipe' })
    })
    const started = await manager.start(projectDir)

    let output = ''
    started.child.stdout.on('data', (d) => { output += d })
    started.child.stderr.on('data', (d) => { output += d })
    const code = await new Promise((resolve) => started.child.on('close', resolve))

    assert.strictEqual(code, 0, `shim failed: ${output}`)
    assert.match(output, /ARGS=ui,--port,45678/)
    assert.ok(output.includes(projectDir), `cwd was not the project dir: ${output}`)
  } finally {
    process.env.PATH = previousPath
    fs.rmSync(base, { recursive: true, force: true })
  }
})

// The .cmd shim cases above need a cmd.exe wrapper, so their argv carries three
// extra leading elements. With an .exe on PATH there is no wrapper and the
// contract can be asserted literally: argv is exactly the three CLI arguments.
test('argv is exactly [ui, --port, <port>] when no cmd.exe wrapper is needed', async () => {
  const { manager, calls } = harness({
    resolveCli: () => 'C:\\Program Files\\connectr\\connectr.exe'
  })
  const started = await manager.start('E:\\My Projects\\connectr demo')

  const { command, args, options } = calls[0]
  assert.strictEqual(command, 'C:\\Program Files\\connectr\\connectr.exe')
  assert.deepStrictEqual(args, ['ui', '--port', String(started.port)])
  assert.strictEqual(options.cwd, 'E:\\My Projects\\connectr demo')
})

test('a project path with spaces reaches spawn as one unmodified argv element', async () => {
  const projectPath = 'E:\\My Projects\\connectr demo'
  const { manager, calls } = harness({
    resolveCli: () => 'C:\\Program Files\\connectr\\connectr.exe'
  })
  await manager.start(projectPath)

  const { args, options } = calls[0]
  // Not split on the spaces, not quoted, not escaped - byte-identical.
  assert.strictEqual(options.cwd, projectPath)
  assert.strictEqual(options.cwd.length, projectPath.length)
  assert.ok(options.cwd.includes(' '), 'the fixture must actually contain spaces')
  assert.ok(!options.cwd.includes('"'), 'cwd must not be quoted')
  // The path belongs in cwd only - it is never smuggled into the arg list.
  assert.deepStrictEqual(args, ['ui', '--port', '41234'])
})

test('a spawn that throws ENOENT surfaces as a rejected start()', async () => {
  const { manager } = harness({
    spawn: () => {
      const err = new Error('spawn connectr ENOENT')
      err.code = 'ENOENT'
      throw err
    }
  })

  await assert.rejects(() => manager.start('E:\\some project'), (err) => {
    assert.strictEqual(err.code, 'ENOENT')
    return true
  })
})

test('an async ENOENT error event from the child clears current()', async () => {
  const { manager } = harness()
  const started = await manager.start('E:\\some project')

  const err = new Error('spawn connectr ENOENT')
  err.code = 'ENOENT'
  assert.doesNotThrow(() => started.child.emit('error', err))
  assert.strictEqual(manager.current(), null)
})
