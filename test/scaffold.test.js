const test = require('node:test')
const assert = require('node:assert')
const pkg = require('../package.json')

test('package.json points at main.js and is dependency-free at runtime', () => {
  assert.strictEqual(pkg.main, 'main.js')
  assert.ok(!pkg.dependencies)
})
