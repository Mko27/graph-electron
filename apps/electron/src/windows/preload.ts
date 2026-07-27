import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('graphClient', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
});
