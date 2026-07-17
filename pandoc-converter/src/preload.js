'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The ONLY bridge between the sandboxed renderer and the main process.
// Everything here is a thin forwarder — the renderer never touches Node, fs,
// or child processes directly.
contextBridge.exposeInMainWorld('api', {
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputFolder: () => ipcRenderer.invoke('pick-output-folder'),
  convert: (payload) => ipcRenderer.invoke('convert', payload),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  showItem: (filePath) => ipcRenderer.invoke('show-item', filePath),
  // For drag-and-drop: resolve a dropped File to its real path (Electron 33+).
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
