import { BrowserWindow } from 'electron';
import { APP_CHROME } from '@graph-client/shared';

export interface WindowConfig {
  width?: number;
  height?: number;
  preloadPath: string;
  indexPath: string;
}

export function createMainWindow(config: WindowConfig): BrowserWindow {
  const isWindows = process.platform === 'win32';

  const win = new BrowserWindow({
    width: config.width ?? 1400,
    height: config.height ?? 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Graph Client',
    backgroundColor: APP_CHROME.background,
    // On Windows the default caption bar is painted by the OS in its own
    // colours, which clashes with the dark app palette. Hiding it and using a
    // titleBarOverlay keeps the native minimise/maximise/close buttons while
    // painting the strip behind them in the app's own chrome colour; the
    // renderer draws a matching draggable strip of the same height.
    ...(isWindows
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: APP_CHROME.titleBar,
            symbolColor: APP_CHROME.symbol,
            height: APP_CHROME.titleBarHeight,
          },
        }
      : {}),
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
