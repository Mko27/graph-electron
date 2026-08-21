import type { IpcMain } from 'electron';
import type { IpcChannels as IpcChannelsType } from '@graph-client/shared';
import type { IpcDependencies } from '../registry';

export function registerDynamoHandlers(
  ipcMain: IpcMain,
  channels: typeof IpcChannelsType,
  { dynamoService, log }: IpcDependencies,
): void {
  ipcMain.handle(channels.DYNAMO_CONFIGURE, async (_event, { region, tableName, endpoint, profile, environment }) => {
    try {
      return dynamoService.configure({ region, tableName, endpoint, profile, environment });
    } catch (err) {
      log('error', 'DynamoDB configure error:', (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  });

  ipcMain.handle(channels.DYNAMO_GET_CONFIG, () => dynamoService.getConfig());

  ipcMain.handle(channels.DYNAMO_FETCH_ITEM, async (_event, { id }) => {
    try {
      return await dynamoService.fetchItem(String(id));
    } catch (err) {
      log('error', `DynamoDB fetch error for id="${id}":`, (err as Error).message);
      return { success: false, message: (err as Error).message };
    }
  });
}
