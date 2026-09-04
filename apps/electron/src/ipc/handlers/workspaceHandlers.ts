import type { IpcMain } from 'electron';
import type { IpcChannels as IpcChannelsType } from '@graph-client/shared';
import type { WorkspaceState } from '@graph-client/shared';
import type { IpcDependencies } from '../registry';

export function registerWorkspaceHandlers(
  ipcMain: IpcMain,
  channels: typeof IpcChannelsType,
  { workspaceStore, log }: IpcDependencies,
): void {
  ipcMain.handle(channels.WORKSPACE_LOAD, () => workspaceStore.load());

  ipcMain.handle(channels.WORKSPACE_SAVE, async (_event, payload) => {
    const state = (payload as { state?: WorkspaceState } | undefined)?.state;
    if (!state || typeof state !== 'object') {
      return { success: false, message: 'state is required' };
    }
    return workspaceStore.save(state);
  });

  ipcMain.handle(channels.WORKSPACE_CLEAR, () => {
    log('info', 'workspace:clear requested');
    return workspaceStore.clear();
  });
}
