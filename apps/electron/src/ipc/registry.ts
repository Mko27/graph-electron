/**
 * IPC Registry — registers all ipcMain handlers in one place.
 *
 * Pattern:
 *   1. Import the typed channel constants from @graph-client/shared
 *   2. Import handler functions from ./handlers/
 *   3. Call ipcMain.handle(channel, handler) for each
 *
 * This file is the ONLY place that binds channels to handlers.
 * Adding a new IPC endpoint = add the handler in ./handlers/, register here.
 */
import { ipcMain } from 'electron';
import { IpcChannels } from '@graph-client/shared';
import type { ConnectionManager } from '@graph-client/core';
import type { DynamoService } from '../services/DynamoService';
import type { WorkspaceStore } from '../services/WorkspaceStore';
import type { AwsProfileService } from '../services/AwsProfileService';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerQueryHandlers } from './handlers/queryHandlers';
import { registerDynamoHandlers } from './handlers/dynamoHandlers';
import { registerWorkspaceHandlers } from './handlers/workspaceHandlers';
import { registerAwsHandlers } from './handlers/awsHandlers';

export interface IpcDependencies {
  connectionManager: ConnectionManager;
  dynamoService: DynamoService;
  workspaceStore: WorkspaceStore;
  awsProfileService: AwsProfileService;
  log: (level: string, ...args: unknown[]) => void;
}

export function registerAllHandlers(deps: IpcDependencies): void {
  registerConnectionHandlers(ipcMain, IpcChannels, deps);
  registerQueryHandlers(ipcMain, IpcChannels, deps);
  registerDynamoHandlers(ipcMain, IpcChannels, deps);
  registerWorkspaceHandlers(ipcMain, IpcChannels, deps);
  registerAwsHandlers(ipcMain, IpcChannels, deps);
}
