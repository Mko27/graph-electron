import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ConnectionManager } from '@graph-client/core';
import { DynamoService } from './services/DynamoService';
import { registerAllHandlers } from './ipc/registry';
import { createMainWindow } from './windows/mainWindow';

let mainWindow: BrowserWindow | null = null;

function log(level: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (level === 'error') console.error(prefix, ...args);
  else console.log(prefix, ...args);

  if (mainWindow && !mainWindow.isDestroyed()) {
    const message = args
      .map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
      .join(' ');
    mainWindow.webContents
      .executeJavaScript(`console.${level}('[main]', ${JSON.stringify(message)})`)
      .catch(() => {});
  }
}

const connectionManager = new ConnectionManager(log);
const dynamoService = new DynamoService(log);

function createWindow(): void {
  mainWindow = createMainWindow({
    preloadPath: path.join(__dirname, 'windows', 'preload.js'),
    indexPath: path.join(__dirname, '..', '..', 'renderer', 'src', 'index.html'),
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    connectionManager.disconnectAll().catch(() => undefined);
  });

  log('info', 'Application window created');
}

app.whenReady().then(() => {
  registerAllHandlers({ connectionManager, dynamoService, log });
  createWindow();
});

app.on('window-all-closed', () => {
  connectionManager.disconnectAll().catch(() => undefined);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception:', err.message, err.stack ?? '');
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection:', String(reason));
});

