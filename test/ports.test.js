const test = require('node:test')
const assert = require('node:assert')
const net = require('node:net')
const { findFreePort } = require('../src/ports')

// Proves the port findFreePort handed back was really released: if it still
// held the socket this listen() would reject with EADDRINUSE.
function bind(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

test('findFreePort resolves an integer inside the usable range', async () => {
  const port = await findFreePort()

  assert.strictEqual(typeof port, 'number')
  assert.ok(Number.isInteger(port), `${port} is not an integer`)
  assert.ok(port >= 1024 && port <= 65535, `${port} is outside 1024-65535`)
})

test('the returned port is actually bindable afterwards', async () => {
  const port = await findFreePort()
  const server = await bind(port)

  assert.strictEqual(server.address().port, port)
  await close(server)
})

test('two calls both hand back usable ports', async () => {
  const first = await findFreePort()
  const second = await findFreePort()

  const a = await bind(first)
  // Same port twice is legal (nothing held the first one in between); only
  // bind a second socket when the OS actually picked a different number.
  const b = first === second ? null : await bind(second)

  assert.ok(Number.isInteger(first) && Number.isInteger(second))
  assert.strictEqual(a.address().port, first)
  if (b) assert.strictEqual(b.address().port, second)

  await close(a)
  if (b) await close(b)
})

test('concurrent calls all resolve to distinct, bindable ports', async () => {
  const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()])

  assert.strictEqual(new Set(ports).size, 3, `expected distinct ports, got ${ports}`)
  const servers = await Promise.all(ports.map(bind))
  await Promise.all(servers.map(close))
})

test('the resolved port survives string interpolation for the CLI flag', async () => {
  const port = await findFreePort()

  assert.strictEqual(String(port), `${port}`)
  assert.match(`http://127.0.0.1:${port}`, /^http:\/\/127\.0\.0\.1:\d+$/)
})
