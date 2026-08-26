'use strict';

// Stand-in for the real preload.js, used only by renderer-smoke.js: same
// window.connectr surface, but backed by scripted data instead of IPC so the
// renderer can be driven without a main process or a connectr CLI.
const { contextBridge } = require('electron');

const SPACED = 'C:\\Users\\me\\My Projects\\app one';
let projects = [];

contextBridge.exposeInMainWorld('connectr', {
  listProjects: async () => projects,
  addProject: async (p) => {
    projects = projects.concat([{ name: p.split('\\').pop(), path: p }]);
    return projects;
  },
  pickFolder: async () => SPACED,
  openProject: async (p) =>
    p === SPACED ? { ok: false, error: 'connectr CLI not found on PATH' } : { ok: true, url: 'http://127.0.0.1:1234' },
  goHome: async () => {},
});
