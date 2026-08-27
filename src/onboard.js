// Onboarding: read which coding tools are ready, help the user sign into the ones that
// are not, and create the project with the tools they picked. Every one of these shells
// out to the connectr CLI - this app never handles a credential itself.
'use strict';

const childProcess = require('child_process');
const { resolveCliPath, buildInvocation, IS_WINDOWS } = require('./server');

// Sign-in commands come from tool specs, which a user can declare in their own config,
// so only plain command shapes are ever handed to a shell.
const SAFE_COMMAND = /^[A-Za-z][\w.-]*(?: [\w.:@/=-]+)*$/;

function isSafeCommand(cmd) {
  return typeof cmd === 'string' && cmd.length > 0 && cmd.length < 120 && SAFE_COMMAND.test(cmd);
}

function runCli(args, opts = {}) {
  const exec = opts.execFile || childProcess.execFile;
  const cliPath = opts.cliPath !== undefined ? opts.cliPath : resolveCliPath('connectr');
  if (!cliPath) {
    return Promise.reject(new Error('connectr CLI not found on PATH - install it with `npm i -g connectr-mcp`'));
  }
  const { command, args: full } = buildInvocation(cliPath, args);
  return new Promise((resolve, reject) => {
    exec(command, full, { cwd: opts.cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').toString().trim()));
      resolve(String(stdout));
    });
  });
}

/** What can this machine actually run, and what still needs a login? */
async function detectTools(opts = {}) {
  const out = await runCli(['tools', '--json'], opts);
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (err) {
    throw new Error('could not read the tool list from connectr');
  }
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

/**
 * Open the tool's own login in a real terminal. We deliberately do not collect
 * credentials in-app: the CLI owns its auth, we just start it where the user can see it.
 * Returns { ok:false, command } when we cannot open one, so the UI can print the command.
 */
function signIn(command, opts = {}) {
  const spawn = opts.spawn || childProcess.spawn;
  const platform = opts.platform || process.platform;
  if (!isSafeCommand(command)) return { ok: false, command, reason: 'unrecognised sign-in command' };

  const parts = command.split(' ');
  try {
    if (platform === 'win32') {
      // start needs an empty title first, or it eats the command as the window title.
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', 'cmd', '/k', ...parts], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      return { ok: true, command };
    }
    if (platform === 'darwin') {
      spawn('open', ['-a', 'Terminal', '--args', ...parts], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, command };
    }
    spawn('x-terminal-emulator', ['-e', command], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, command };
  } catch (err) {
    return { ok: false, command, reason: 'could not open a terminal' };
  }
}

/** Create the project with exactly the tools the user chose. */
async function createProject(dir, tools, mode, opts = {}) {
  if (!dir) throw new Error('choose a folder first');
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('pick at least one tool');
  const args = ['new', dir, '--tools', tools.join(','), '--mode', mode || 'auto', '--yes'];
  await runCli(args, opts);
  return { dir, tools, mode: mode || 'auto' };
}

/**
 * Hand the user's intent to the dashboard's planner. The wizard page and the dashboard are
 * different origins, so nothing can be carried across in the renderer - the main process
 * posts it to the server it just started instead. Best effort: if planning cannot be
 * kicked off, the user still lands on the board and can plan from the composer.
 */
function postPlan(port, intent, opts = {}) {
  const http = opts.http || require('http');
  const body = JSON.stringify({ intent });
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/plan',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode === 200, status: res.statusCode });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end(body);
  });
}

module.exports = { detectTools, signIn, createProject, postPlan, isSafeCommand, runCli, IS_WINDOWS };
