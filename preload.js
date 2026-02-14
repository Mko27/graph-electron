const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neptune', {
  connect: (config) => ipcRenderer.invoke('connect', config),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  executeQuery: (query) => ipcRenderer.invoke('execute-query', query),
  getSchema: () => ipcRenderer.invoke('get-schema'),
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
});

