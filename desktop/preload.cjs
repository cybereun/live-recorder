const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  setMode: mode => ipcRenderer.invoke('view-mode', mode),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  closeReady: result => ipcRenderer.send('close-ready', result),
  onPrepareClose: callback => ipcRenderer.on('prepare-close', () => callback()),
  onUpdateStatus: callback => ipcRenderer.on('update-status', (_event, message) => callback(message)),
});
