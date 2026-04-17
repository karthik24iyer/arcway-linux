const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  retry: () => ipcRenderer.invoke('retry'),
  quit: () => ipcRenderer.invoke('quit'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  setKeepAwake: (enabled) => ipcRenderer.invoke('set-keep-awake', enabled),
  getRelayUrl: () => ipcRenderer.invoke('get-relay-url'),
  setRelayUrl: (url) => ipcRenderer.invoke('set-relay-url', url),
  checkFileAccess: () => ipcRenderer.invoke('check-file-access'),
  resize: (height) => ipcRenderer.invoke('resize', height),
  onState: (callback) => ipcRenderer.on('state', (_, state) => callback(state)),
});
