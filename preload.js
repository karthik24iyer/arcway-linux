const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onShown: (cb) => ipcRenderer.on('shown', () => cb()),
});
