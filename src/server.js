'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { findFreePort: defaultFindFreePort } = require('./ports');

const IS_WINDOWS = process.platform === 'win32';

// A global `connectr` on Windows is a .cmd shim, and Node refuses to spawn one
// without a shell (EINVAL) while shell:true concatenates - and mangles - the
// argument list. So we look the shim up on PATH ourselves, which also turns a
// missing CLI into an immediate ENOENT instead of a shell that exits 1, and
// hand its absolute path to cmd.exe as one element of an args array.
function resolveCliPath(name) {
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
    : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (err) {
        // not here, keep looking
      }
    }
  }
  return null;
}

function buildInvocation(cliPath, args) {
  if (!IS_WINDOWS || path.extname(cliPath).toLowerCase() === '.exe') {
    return { command: cliPath, args };
  }
  // /d skips AutoRun scripts. Deliberately no /s: with /s cmd strips the quotes
  // Node put around a path containing spaces and then fails on the first space.
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/c', cliPath, ...args]
  };
}

// Synchronous on purpose: app quit must not return before the tree is gone.
function defaultKillTree(pid) {
  if (!IS_WINDOWS) return;
  childProcess.execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore'
  });
}

function createServerManager(deps = {}) {
  const spawn = deps.spawn || childProcess.spawn;
  const findFreePort = deps.findFreePort || defaultFindFreePort;
  const resolveCli = deps.resolveCli || (() => resolveCliPath('connectr'));
  const killTree = deps.killTree || defaultKillTree;

  let active = null;

  function stop() {
    if (!active) return;
    const { child } = active;
    active = null;
    try {
      if (child.pid) killTree(child.pid);
      child.kill();
    } catch (err) {
      // already dead, or taskkill found nothing - nothing left to do
    }
  }

  async function start(projectPath) {
    stop();

    const cliPath = resolveCli();
    if (!cliPath) {
      const err = new Error(
        'connectr CLI not found on PATH - install it with `npm i -g connectr`'
      );
      err.code = 'ENOENT';
      throw err;
    }

    const port = await findFreePort();
    const invocation = buildInvocation(cliPath, ['ui', '--port', String(port)]);
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectPath,
      stdio: 'ignore',
      windowsHide: true
    });

    const url = `http://127.0.0.1:${port}`;
    active = { port, url, projectPath, child };

    // Without these the child's own 'error' event would throw process-wide.
    const forget = () => {
      if (active && active.child === child) active = null;
    };
    child.on('error', forget);
    child.on('exit', forget);

    return { port, url, child };
  }

  function current() {
    if (!active) return null;
    return { port: active.port, url: active.url, projectPath: active.projectPath };
  }

  return { start, stop, current };
}

module.exports = { createServerManager };
