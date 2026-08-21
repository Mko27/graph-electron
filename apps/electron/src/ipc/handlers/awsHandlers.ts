import type { IpcMain } from 'electron';
import type { IpcChannels as IpcChannelsType } from '@graph-client/shared';
import type { IpcDependencies } from '../registry';

export function registerAwsHandlers(
  ipcMain: IpcMain,
  channels: typeof IpcChannelsType,
  { awsProfileService, log }: IpcDependencies,
): void {
  ipcMain.handle(channels.AWS_LIST_PROFILES, () => {
    try {
      return awsProfileService.listProfiles();
    } catch (err) {
      log('error', 'aws:list-profiles error:', (err as Error).message);
      return { success: false, profiles: [], sources: [], message: (err as Error).message };
    }
  });
}
