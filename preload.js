'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connectr', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: (path) => ipcRenderer.invoke('projects:add', path),
  pickFolder: () => ipcRenderer.invoke('projects:pickFolder'),
  openProject: (path) => ipcRenderer.invoke('project:open', path),
  goHome: () => ipcRenderer.invoke('project:home'),
});
