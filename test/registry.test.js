const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { registryPath, readProjects, addProject } = require('../src/registry')

// Every case gets its own temp dir so a failure never leaks into the next test
// and the real ~/.connectr/projects.json is never touched.
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connectr-registry-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('registryPath points at ~/.connectr/projects.json', () => {
  assert.strictEqual(registryPath(), path.join(os.homedir(), '.connectr', 'projects.json'))
})

test('a missing registry file reads as an empty list, not a throw', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'nested', 'projects.json')
    assert.deepStrictEqual(readProjects(file), [])
    assert.strictEqual(fs.existsSync(file), false, 'reading must not create the file')
  })
})

test('corrupt JSON reads as an empty list', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'projects.json')
    fs.writeFileSync(file, '{ not json at all,,,')
    assert.deepStrictEqual(readProjects(file), [])
  })
})

test('a JSON value that is not an array reads as an empty list', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'projects.json')
    fs.writeFileSync(file, '{"projects":[]}')
    assert.deepStrictEqual(readProjects(file), [])
  })
})

test('malformed entries are dropped and good ones survive', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'projects.json')
    fs.writeFileSync(
      file,
      JSON.stringify([
        { name: 'good', path: 'E:\\good' },
        null,
        'a bare string',
        42,
        { name: 'no path' },
        { path: 'E:\\no-name' },
        { name: 7, path: 'E:\\bad-name-type' },
        { name: 'bad path type', path: [] },
        { name: 'extra keys', path: 'E:\\extra', color: 'red' }
      ])
    )
    assert.deepStrictEqual(readProjects(file), [
      { name: 'good', path: 'E:\\good' },
      { name: 'extra keys', path: 'E:\\extra' }
    ])
  })
})

test('addProject creates missing directories and appends an entry', () => {
  withTempDir((dir) => {
    const file = path.join(dir, '.connectr', 'projects.json')
    const projectDir = path.join(dir, 'alpha')
    fs.mkdirSync(projectDir)

    const returned = addProject(projectDir, file)

    assert.strictEqual(fs.existsSync(file), true, 'addProject must create .connectr/')
    assert.deepStrictEqual(returned, [{ name: 'alpha', path: projectDir }])
    assert.deepStrictEqual(readProjects(file), [{ name: 'alpha', path: projectDir }])
  })
})

test('addProject appends without discarding existing entries', () => {
  withTempDir((dir) => {
    const file = path.join(dir, '.connectr', 'projects.json')
    const first = path.join(dir, 'alpha')
    const second = path.join(dir, 'beta')

    addProject(first, file)
    const returned = addProject(second, file)

    assert.deepStrictEqual(returned, [
      { name: 'alpha', path: first },
      { name: 'beta', path: second }
    ])
    assert.deepStrictEqual(readProjects(file), returned)
  })
})

test('addProject is idempotent - adding the same path twice adds one entry', () => {
  withTempDir((dir) => {
    const file = path.join(dir, '.connectr', 'projects.json')
    const projectDir = path.join(dir, 'alpha')

    addProject(projectDir, file)
    addProject(projectDir, file)
    // A non-normalised spelling of the same directory must also dedupe.
    const returned = addProject(projectDir + path.sep + '.', file)

    assert.strictEqual(returned.length, 1)
    assert.deepStrictEqual(readProjects(file), [{ name: 'alpha', path: projectDir }])
  })
})

test('a path containing spaces round-trips through write and read unmodified', () => {
  withTempDir((dir) => {
    const file = path.join(dir, '.connectr', 'projects.json')
    const projectDir = path.join(dir, 'My Projects', 'connectr demo app')
    fs.mkdirSync(projectDir, { recursive: true })

    addProject(projectDir, file)
    const [entry] = readProjects(file)

    assert.strictEqual(entry.path, projectDir)
    assert.strictEqual(entry.name, 'connectr demo app')
    assert.ok(entry.path.includes(' '), 'the fixture must actually contain a space')
    // Backslashes survive the JSON round trip rather than becoming escapes.
    assert.strictEqual(entry.path.split(path.sep).pop(), 'connectr demo app')
  })
})

test('the file on disk is human-editable pretty JSON', () => {
  withTempDir((dir) => {
    const file = path.join(dir, '.connectr', 'projects.json')
    addProject(path.join(dir, 'alpha'), file)

    const raw = fs.readFileSync(file, 'utf8')
    assert.match(raw, /\n/, 'expected indented JSON, not one long line')
    assert.deepStrictEqual(JSON.parse(raw), readProjects(file))
  })
})
