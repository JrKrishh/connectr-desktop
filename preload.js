'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connectr', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: (path) => ipcRenderer.invoke('projects:add', path),
  pickFolder: () => ipcRenderer.invoke('projects:pickFolder'),
  openProject: (path, intent) => ipcRenderer.invoke('project:open', path, intent),
  goHome: () => ipcRenderer.invoke('project:home'),
  detectTools: (dir) => ipcRenderer.invoke('tools:detect', dir),
  signIn: (command) => ipcRenderer.invoke('tools:signIn', command),
  createProject: (opts) => ipcRenderer.invoke('project:create', opts),
});
