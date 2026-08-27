'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { detectTools, signIn, createProject, isSafeCommand } = require('../src/onboard')

const CLI = 'C:\\npm\\connectr.cmd'

function fakeExec (stdout, err) {
  const calls = []
  const execFile = (command, args, opts, cb) => {
    calls.push({ command, args, cwd: opts && opts.cwd })
    cb(err || null, stdout || '', err ? 'boom' : '')
  }
  return { execFile, calls }
}

test('detectTools reads the CLI JSON and returns the tool list', async () => {
  const { execFile, calls } = fakeExec(JSON.stringify({
    tools: [{ tool: 'codex', kind: 'dispatch', installed: true, signedIn: false, signInHint: 'codex login' }]
  }))
  const tools = await detectTools({ execFile, cliPath: CLI, cwd: 'E:\\proj' })
  assert.strictEqual(tools.length, 1)
  assert.strictEqual(tools[0].signInHint, 'codex login')
  assert.deepStrictEqual(calls[0].args.slice(-2), ['tools', '--json'])
  assert.strictEqual(calls[0].cwd, 'E:\\proj')
})

test('detectTools surfaces a missing CLI instead of hanging', async () => {
  await assert.rejects(
    () => detectTools({ execFile: () => {}, cliPath: null }),
    /connectr CLI not found/
  )
})

test('detectTools reports unreadable output rather than throwing a parse error', async () => {
  const { execFile } = fakeExec('not json at all')
  await assert.rejects(() => detectTools({ execFile, cliPath: CLI }), /could not read the tool list/)
})

test('createProject passes exactly the chosen tools to connectr new', async () => {
  const { execFile, calls } = fakeExec('')
  const made = await createProject('E:\\app', ['claude-code', 'codex'], 'auto', { execFile, cliPath: CLI })
  const args = calls[0].args
  assert.ok(args.includes('new'))
  assert.ok(args.includes('E:\\app'))
  assert.deepStrictEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', 'claude-code,codex'])
  assert.ok(args.includes('--yes'))
  assert.deepStrictEqual(made.tools, ['claude-code', 'codex'])
})

test('createProject refuses an empty folder or an empty tool list', async () => {
  const { execFile } = fakeExec('')
  await assert.rejects(() => createProject('', ['codex'], 'auto', { execFile, cliPath: CLI }), /choose a folder/)
  await assert.rejects(() => createProject('E:\\a', [], 'auto', { execFile, cliPath: CLI }), /at least one tool/)
})

test('only plain sign-in commands are ever handed to a shell', () => {
  assert.ok(isSafeCommand('codex login'))
  assert.ok(isSafeCommand('claude'))
  assert.ok(isSafeCommand('aider --login'))
  for (const bad of ['codex login && del /q *', 'rm -rf ~', 'a | b', 'x; y', '$(whoami)', '`id`', '']) {
    assert.strictEqual(isSafeCommand(bad), false, bad)
  }
})

test('signIn opens the tool own login in a terminal and never returns a credential', () => {
  const spawned = []
  const spawn = (command, args) => {
    spawned.push({ command, args })
    return { unref () {} }
  }
  const r = signIn('codex login', { spawn, platform: 'win32' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.command, 'codex login')
  assert.ok(!('token' in r) && !('credential' in r))
  const args = spawned[0].args
  assert.ok(args.includes('start'))
  assert.ok(args.includes('codex') && args.includes('login'))
})

test('signIn rejects an unsafe command without spawning anything', () => {
  let spawned = 0
  const r = signIn('codex login && shutdown', { spawn: () => { spawned++; return { unref () {} } }, platform: 'win32' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(spawned, 0)
  assert.match(r.reason, /unrecognised/)
})

test('signIn degrades to telling the user the command when no terminal can open', () => {
  const r = signIn('codex login', {
    spawn: () => { throw new Error('no terminal') },
    platform: 'linux'
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.command, 'codex login')
})
