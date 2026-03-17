const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  retry: () => ipcRenderer.invoke('retry'),
  quit: () => ipcRenderer.invoke('quit'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  setKeepAwake: (enabled) => ipcRenderer.invoke('set-keep-awake', enabled),
  onState: (callback) => ipcRenderer.on('state', (_, state) => callback(state)),
});
