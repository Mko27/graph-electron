import { BrowserWindow, shell } from 'electron';
import { APP_CHROME } from '@graph-client/shared';

export interface WindowConfig {
  width?: number;
  height?: number;
  preloadPath: string;
  indexPath: string;
}

/**
 * Hosts the app may open in the user's browser. Everything else is refused
 * rather than opened, so a stray or injected link cannot reach an arbitrary
 * site — and never inside the app window.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'docs.aws.amazon.com',
  'neo4j.com',
  'tinkerpop.apache.org',
]);

function isAllowedExternal(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Confine the window to the app's own bundled page.
 *
 * Without these the window will follow any navigation it is given and open
 * arbitrary popups — the standard hardening step for an Electron app, and it
 * was simply absent. Nothing in the current UI triggers a navigation, so this
 * costs nothing and closes the hole.
 */
function applyNavigationGuards(win: BrowserWindow, indexPath: string): void {
  const isOwnPage = (rawUrl: string): boolean => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'file:') return false;
      return decodeURIComponent(url.pathname) === indexPath;
    } catch {
      return false;
    }
  };

  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(url)) return;
    event.preventDefault();
    if (isAllowedExternal(url)) void shell.openExternal(url);
  });

  // Covers <a href> with a target, window.open, and anything else asking for a
  // new window: never open one, hand approved links to the OS browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // A renderer that somehow navigates anyway is a bug worth surfacing.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
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
      // The preload only uses contextBridge/ipcRenderer, both available in a
      // sandboxed preload, so the extra containment costs nothing here.
      sandbox: true,
      webSecurity: true,
      // No part of the UI embeds another page.
      webviewTag: false,
    },
  });

  applyNavigationGuards(win, config.indexPath);

  win.loadFile(config.indexPath);
  return win;
}
