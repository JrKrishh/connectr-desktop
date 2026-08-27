# ConnectR Desktop

A native Windows shell around the local ConnectR dashboard.

It does **not** reimplement the dashboard. The dashboard is served by the `connectr`
CLI itself; this app spawns `connectr ui --port <free port>` inside a project folder
and points a native Electron window at `http://127.0.0.1:<port>`. What you get on top
of a browser tab is a project picker, a system tray, and a server child process whose
lifetime is tied to the window's.

## How this app was built

Every file in this repo except `PLAN.md` was written by AI agents dispatched by
[ConnectR](https://github.com/JrKrishh/connectr) — the tool this app is a shell for.

A person wrote `PLAN.md` (the goal, the features, the constraints) and ran:

```
connectr new connectr-desktop --plan PLAN.md
```

ConnectR read the plan, worked out which installed coding tools the project needed, wired
them to one shared brain, and seeded a single ticket: *decompose the plan into tickets*.
The agent that claimed it read `PLAN.md` and created nine more. Those went out in four
waves of headless agents running in parallel — each claiming its ticket on the shared
board before writing a line, which is what kept two agents off the same file.

The board kept the receipts:

| | |
|---|---|
| Tickets | 10, every one closed `completed` |
| Distinct agent sessions | 9 |
| Interface contracts published between agents | 8 |
| Shared memories written | 22 — 7 decisions, 7 facts, **8 lessons** |
| Verification | 61 unit tests + 3 real-Electron smoke suites |

The lessons are the part worth reading. When an agent hit a wall it recorded the root
cause and the corrective action, so the next agent along didn't pay for it twice:

> **Spawning the global `connectr` on Windows has two traps:** Node 24 throws `EINVAL`
> for `spawn()` of a `.cmd` without a shell, and routing through `cmd.exe` mangles the
> argument list. *Fix: resolve `connectr.cmd` on PATH yourself, then spawn ComSpec with
> `['/d','/c',cliPath,...args]`.*

> **A successful `project:open` navigates the BrowserWindow,** which destroys the renderer
> context that issued `ipcRenderer.invoke` — so the `{ ok: true }` reply never arrives.
> *Fix: renderers must treat "no reply" as success and render only the failure branch.*

Both are load-bearing in `src/server.js` and `renderer/renderer.js` today. The second was
written by the agent building the main process while the agent building the picker was
still running — two processes on opposite sides of the same IPC boundary, three minutes
apart, coordinating through nothing but the board.

## Prerequisites

- **Node.js** (built and verified on v24.3.0, npm 11.4.2)
- **The connectr CLI installed globally and on PATH.** This is the hard requirement -
  the app shells out to it by name and will not start a dashboard without it.

```
npm i -g connectr-mcp
connectr --version
```

`connectr --version` must print a version (e.g. `0.1.0`). If it errors, fix PATH before
going further - see [Troubleshooting](#troubleshooting).

## Install and run

```
npm install
npm start
```

`npm start` runs `electron .` and opens the picker window.

To skip the picker and open a project straight away:

```
npm start -- --project E:\Freelancing\my-app
```

`--project <path>` (or `--project=<path>`) also works on the packaged app, and on a
second launch: because the app is single-instance, launching it again with a different
`--project` switches the window you already have instead of starting a rival. That makes
per-project shortcuts possible - point a shortcut at the exe with the flag appended.

## Starting a project

**+ New project (guided setup)** walks three steps:

1. **Choose a folder** — where the agents will work.
2. **Pick your tools** — every coding tool on this machine, with whether it is installed
   and signed in. Anything signed out gets a **Sign in** button that opens that tool own
   login in a terminal; **Re-check** re-reads the state. Only tools that are actually
   ready can be ticked, so you cannot hand work to a tool that will fail.
3. **Plan or build** — describe an outcome and ConnectR breaks it into routed tasks before
   the board opens, or skip straight to the board.

Detection comes from {
  "tools": [
    {
      "tool": "claude-code",
      "kind": "dispatch",
      "installed": true,
      "signedIn": true,
      "signInHint": "claude",
      "via": "claude on PATH",
      "targetSlugs": [
        "claude",
        "claude-md"
      ]
    },
    {
      "tool": "codex",
      "kind": "dispatch",
      "installed": true,
      "signedIn": true,
      "signInHint": "codex login",
      "via": "codex on PATH",
      "targetSlugs": [
        "codex"
      ]
    },
    {
      "tool": "gemini",
      "kind": "dispatch",
      "installed": true,
      "signedIn": true,
      "signInHint": "gemini",
      "via": "gemini on PATH",
      "targetSlugs": [
        "gemini-md",
        "gemini"
      ]
    },
    {
      "tool": "cursor",
      "kind": "participant",
      "installed": true,
      "signedIn": null,
      "via": "~/.cursor",
      "targetSlugs": [
        "cursor",
        "cursor-rules"
      ]
    },
    {
      "tool": "kiro",
      "kind": "participant",
      "installed": true,
      "signedIn": null,
      "via": "~/.kiro",
      "targetSlugs": [
        "kiro",
        "kiro-steering"
      ]
    },
    {
      "tool": "antigravity",
      "kind": "participant",
      "installed": true,
      "signedIn": null,
      "via": "~/.gemini/antigravity-ide",
      "targetSlugs": [
        "antigravity"
      ]
    }
  ],
  "permissionMode": "yolo"
}, and creation runs  with the
tools you picked. **This app never handles a credential**: signing in happens in the tool own
CLI, and ConnectR only ever checks whether a credential file exists.

## Keyboard

You are never stuck inside a project. Every route out is an accelerator, and the
application menu lists them all:

| Key | Does |
|---|---|
| `Ctrl+K` | Switch project — a filterable list, arrows to move, enter to open |
| `Ctrl+O` | Back to all projects |
| `Ctrl+R` | Reload the dashboard |
| `Ctrl+W` | Close to tray (the app keeps running) |
| `Ctrl+Q` | Quit, stopping the dashboard server |

**Project → Recent** holds your last eight projects, so switching is usually one menu
click. The list rebuilds whenever you add a project.

The switcher itself is rendered by the dashboard, not the shell: the preload exposes
`window.connectr` to the page it loads, so the dashboard can tell it is running inside the
desktop app and grow a **Projects** button and the `Ctrl+K` palette. Open the same
dashboard in a browser and neither appears — it stays a plain web page.

## Build the installer

```
npm run dist
```

electron-builder produces an unpacked tree plus a Windows installer:

```
dist/ConnectR Desktop Setup 0.1.0.exe   (~80 MB, NSIS installer)
dist/win-unpacked/                      (the same app, unpacked - runnable directly)
```

The installer is per-user (no admin prompt), lets you choose the install directory, and
creates Start Menu and desktop shortcuts. The version in the filename tracks `version` in
`package.json`. The build is unsigned, so Windows SmartScreen will warn on first run.

Note the installer bundles this app only - **it does not bundle the connectr CLI**.
The machine running it still needs `connectr` on PATH.

## Test

```
npm test
```

Runs the headless unit suite with `node --test` (covering the registry, the port picker,
the server child lifecycle, the main-process IPC handlers, the preload contract and the
tray; 59 tests green at the time of writing).

Three additional smoke scripts drive real Electron. They open windows and, in the case
of `smoke:main`, really spawn a dashboard, so they are not part of `npm test`:

```
npm run smoke:main       # window + all five IPC channels + a live connectr ui round trip
npm run smoke:renderer   # the picker page in a real BrowserWindow
npm run smoke:tray       # tray menu, hide-to-tray, single-instance lock
```

Each exits 0 on success and prints a per-check `ok` line.

## How projects work

The project list lives in a single JSON file:

```
C:\Users\<you>\.connectr\projects.json
```

It is a flat array of `{ name, path }` objects:

```json
[
  {
    "name": "connectr-desktop",
    "path": "E:\\Freelancing\\connectr-desktop"
  },
  {
    "name": "My App",
    "path": "C:\\Users\\me\\My Projects\\My App"
  }
]
```

The file is optional. If it is missing, unreadable, or not a JSON array, the picker
simply shows its empty state - it is never treated as an error. Entries that are not
objects with string `name` and `path` are skipped rather than crashing the list.

**Adding a project from the picker.** Type or paste a folder path into the input and
press *Add project*, or press *Browse...* to choose the folder from a native dialog
(which fills the input for you). The app resolves the path to an absolute one, uses the
folder's basename as `name`, and appends it. Adding a folder that is already in the list
(by resolved path) is a no-op, so the button is safe to press twice.

**Adding a project by editing the file.** Append an object with `name` and `path` and
save. `path` should be absolute; JSON requires backslashes to be escaped (`\\`), or you
can use forward slashes. Restart the app, or return to the picker, to see the change -
the list is read when the picker page loads.

Paths with spaces are supported end to end (the picker, the registry, and the spawned
CLI invocation).

## Behaviour notes

- **Closing the window hides to tray.** The X button is intercepted; the app keeps
  running with its tray icon. Double-click the tray icon, or use its *Show* item, to
  bring the window back. The tray menu relabels itself *Show* / *Hide* to match.
- **Quit from the tray fully exits.** The tray's *Quit* item stops the dashboard child
  and exits the app. This is the only clean way out - there are no orphaned
  `connectr ui` node processes afterwards (asserted by `npm run smoke:tray` and
  `npm run smoke:main`).
- **A second launch focuses the existing window.** A single-instance lock means running
  `npm start` (or the .exe) again restores, shows and focuses the window you already
  have instead of opening a second one.
- **Switching projects restarts the dashboard server.** Opening a project always stops
  the previous child first, picks a fresh free port, and spawns a new
  `connectr ui --port <port>` with `cwd` set to the new project. Returning to the picker
  stops the child without starting a replacement.
- **Ports are picked, not configured.** Each launch binds port 0 to find a free port,
  so there is nothing to configure and no fixed port to collide with.
- **Known gap: there is no Back control on the dashboard page.** The main process fully
  supports returning to the picker (the `project:home` channel, exercised by
  `npm run smoke:main`), but the dashboard UI is served by connectr and this app
  deliberately does not modify it, so nothing on that page triggers it. In practice,
  switching projects today means quitting from the tray and relaunching.

## Troubleshooting

### "connectr CLI not found on PATH"

The picker shows this inline and stays put:

```
connectr CLI not found on PATH - install it with `npm i -g connectr`
```

The app resolves `connectr` on PATH itself (walking `PATH` against `PATHEXT`) rather
than going through a shell, so this message means the shim genuinely is not there.
Check it:

```
where connectr
connectr --version
```

`where connectr` should print something like
`C:\Users\<you>\AppData\Roaming\npm\connectr.cmd`. If it prints nothing:

- Install the CLI globally: `npm i -g connectr`
- Make sure npm's global bin directory (`npm prefix -g`, usually `%APPDATA%\npm`) is
  on PATH.
- If you just changed PATH, **restart the app** - it inherits the environment it was
  launched with, so a PATH edit made after launch is invisible to it.

### "the dashboard did not start listening on port N"

After spawning the CLI the app polls the port for 20 seconds before giving up with this
message. It means the child started but never bound the port. Reproduce it by hand in
the project folder:

```
connectr ui --port 4399
```

A healthy run prints:

```
connectr ui -> http://127.0.0.1:4399   (Ctrl+C to stop)
```

If that fails, the problem is in the CLI or the project folder, not this app. If it
succeeds, the likely cause is that something grabbed the port in the gap between the app
picking it and the CLI binding it - just try the project again, which picks a new port.

### Port already in use

Because ports are chosen dynamically this is rare, but to see who holds one:

```
netstat -ano | findstr :4399
```

The last column is the PID. Identify it before killing anything:

```
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"ProcessId=1234\" | Select-Object ProcessId, CommandLine | Format-List"
```

Note that a port shown in `TIME_WAIT` is not held by anyone - that is a closed
connection draining, and the port is already reusable.

### Orphaned server process

The app kills the dashboard child (and its whole process tree, via
`taskkill /pid <pid> /T /F`) on tray-Quit, on `before-quit` and on `will-quit`, so a
normal exit leaves nothing behind. A hard kill of the app - Task Manager *End task*, a
crash, or killing the Electron process directly - skips those hooks and can leave a
`connectr ui --port N` node process running.

Find them:

```
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Select-Object ProcessId, CommandLine | Format-List"
```

Look for a command line containing `ui --port`. Kill the tree by PID:

```
taskkill /pid <pid> /T /F
```

Run that in cmd or PowerShell. Git Bash rewrites `/pid` into a Windows path and taskkill
rejects it (`Invalid argument/option - 'C:/Program Files/Git/pid'`).

An orphan is harmless apart from holding its port and the project's files, and it will
never be reused by the app - each launch spawns its own child on a new port.

## Project layout

```
main.js                Electron main process: window, five IPC channels, quit cleanup
preload.js             exposes window.connectr over contextBridge (contextIsolation on)
renderer/              the picker home screen (index.html + renderer.js)
src/registry.js        read/write ~/.connectr/projects.json
src/ports.js           free-port picker (bind port 0)
src/server.js          connectr ui child lifecycle: spawn, kill previous, kill tree
src/tray.js            tray icon, hide-to-tray, single-instance lock
test/*.test.js         headless unit tests (npm test)
test/*-smoke.js        real-Electron smoke scripts (npm run smoke:*)
```

Plain CommonJS, no bundler, no build step. The only dependencies are `electron` and
`electron-builder`, both dev-only - the shipped app has zero runtime dependencies.
