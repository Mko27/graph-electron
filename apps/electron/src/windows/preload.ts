import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('graphClient', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload),
  /**
   * Host platform ('darwin' | 'win32' | 'linux'). The renderer uses this to
   * decide whether to draw its own title bar (Windows, where the native caption
   * is replaced by a colour-matched overlay) or leave the OS chrome alone.
   */
  platform: process.platform,
});
