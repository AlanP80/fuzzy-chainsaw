// Ponte sicuro tra l'interfaccia e il processo principale
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['open-path', 'menu', 'fullscreen']);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  fileUrl: p => 'apv://f/?p=' + encodeURIComponent(p),
  locations: () => ipcRenderer.invoke('locations'),
  listDir: dir => ipcRenderer.invoke('list-dir', dir),
  dirMtime: dir => ipcRenderer.invoke('dir-mtime', dir),
  thumb: p => ipcRenderer.invoke('thumb', p),
  preview: (p, urgent) => ipcRenderer.invoke('preview', p, !!urgent),
  exif: p => ipcRenderer.invoke('exif', p),
  openWith: (p, which) => ipcRenderer.invoke('open-with', p, which),
  openDefault: p => ipcRenderer.invoke('open-default', p),
  reveal: p => ipcRenderer.invoke('reveal', p),
  trash: (paths, label) => ipcRenderer.invoke('trash', paths, label),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  contextMenu: items => ipcRenderer.invoke('context-menu', items),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: patch => ipcRenderer.invoke('settings-set', patch),
  setFullscreen: value => ipcRenderer.invoke('fullscreen', value),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  log: msg => ipcRenderer.invoke('log', String(msg)),
  pathForFile: file => webUtils.getPathForFile(file),
  on: (channel, cb) => {
    if (EVENTS.has(channel)) ipcRenderer.on(channel, (_e, ...args) => cb(...args));
  }
});
