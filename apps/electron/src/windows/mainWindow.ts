import { BrowserWindow } from 'electron';

export interface WindowConfig {
  width?: number;
  height?: number;
  preloadPath: string;
  indexPath: string;
}

export function createMainWindow(config: WindowConfig): BrowserWindow {
  const win = new BrowserWindow({
    width: config.width ?? 1400,
    height: config.height ?? 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Graph Client',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: config.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(config.indexPath);
  return win;
}
