import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@graph-client/shared';

/**
 * Channels the renderer is allowed to invoke.
 *
 * The bridge used to forward ANY channel name the page asked for, which made it
 * an unrestricted gateway into the main process. Deriving the allowlist from
 * IpcChannels keeps it exhaustive without hand-maintenance: a new channel is
 * reachable only once it is registered there.
 */
const INVOKABLE = new Set<string>(
  Object.values(IpcChannels).filter((channel) => channel !== IpcChannels.MAIN_LOG),
);

/** Channels the main process may push to the renderer. */
const SUBSCRIBABLE = new Set<string>([IpcChannels.MAIN_LOG]);

contextBridge.exposeInMainWorld('graphClient', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!INVOKABLE.has(channel)) {
      return Promise.reject(new Error(`IPC channel "${channel}" is not allowed`));
    }
    return ipcRenderer.invoke(channel, payload);
  },

  /**
   * Subscribe to a main→renderer push channel. Returns an unsubscribe function.
   * The event object itself is never handed to the page — only the payload.
   */
  subscribe: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    if (!SUBSCRIBABLE.has(channel)) {
      throw new Error(`IPC channel "${channel}" is not subscribable`);
    }
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * Host platform ('darwin' | 'win32' | 'linux'). The renderer uses this to
   * decide whether to draw its own title bar (Windows, where the native caption
   * is replaced by a colour-matched overlay) or leave the OS chrome alone.
   */
  platform: process.platform,
});
