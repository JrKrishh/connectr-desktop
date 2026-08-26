'use strict';

const net = require('node:net');

// Bind to port 0 on loopback: the OS hands back an unused port, which we read
// and release. Good enough for immediately spawning `connectr ui --port <n>`.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

module.exports = { findFreePort };
