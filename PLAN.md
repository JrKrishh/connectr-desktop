# ConnectR Desktop

## Goal
A Windows desktop app that wraps the local ConnectR web dashboard in a native window - one
app to open any project using the connectr shared brain. Built with Electron in plain
JavaScript (no bundler), because the dashboard already exists as a local web server and
only needs a native shell, tray, and project switching.

## Features
- Main process starts the dashboard server for a selected project directory by spawning
  the globally installed CLI: `connectr ui --port <free port>` with cwd set to the project,
  then opens a BrowserWindow on http://127.0.0.1:<port>
- Home screen (before a project is picked): project picker listing entries from
  ~/.connectr/projects.json ({ name, path } array), with an "Add project" input that
  appends a folder path to the registry file
- Switching projects kills the previous server child process and starts a new one
- System tray icon with show/hide window and quit; closing the window hides to tray
- Single-instance lock: a second launch focuses the existing window
- npm scripts: `npm start` runs electron, `npm run dist` builds a portable Windows .exe
  with electron-builder

## Constraints
- Plain JavaScript, CommonJS, no build step; dependencies limited to electron and
  electron-builder (dev)
- Windows-first; every spawned path must survive spaces in directory names
- The dashboard UI is served by connectr itself - do NOT rebuild or restyle it, only
  window it
- Server children must be killed on app quit - no orphaned node processes
- Verify by running tests where possible; the Electron window itself cannot be opened in
  headless verification, so keep main-process logic (registry read/write, port picking,
  child lifecycle) in small requirable modules with unit tests

## Out of scope
- macOS/Linux packaging, auto-update, custom renderer UI beyond the picker, editing the
  dashboard itself
