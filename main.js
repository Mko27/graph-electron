const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const gremlin = require('gremlin');

let mainWindow;
let gremlinClient = null;
let connectionUrl = null;

// ===== Logging helper — prints to terminal AND sends to renderer DevTools =====
function log(level, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
  // Forward logs to renderer DevTools console
  if (mainWindow && !mainWindow.isDestroyed()) {
    const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
    mainWindow.webContents.executeJavaScript(
      `console.${level}('[main]', ${JSON.stringify(message)})`
    ).catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Neptune Graph Client',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open DevTools for debugging (inspect, console, error logs)
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
    disconnectFromNeptune();
  });

  log('info', 'Application window created');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  disconnectFromNeptune();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Catch unhandled errors in main process
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception in main process:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection in main process:', String(reason));
});

// --- Neptune / Gremlin Connection ---

async function connectToNeptune(endpoint, port, useSsl) {
  disconnectFromNeptune();

  const protocol = useSsl ? 'wss' : 'ws';
  const url = `${protocol}://${endpoint}:${port}/gremlin`;
  connectionUrl = url;

  log('info', `Connecting to Neptune at ${url}...`);

  try {
    const { Client } = gremlin.driver;

    gremlinClient = new Client(url, {
      traversalSource: 'g',
      mimeType: 'application/json',
      pingEnabled: false,
    });

    await gremlinClient.open();
    log('info', `Successfully connected to ${url}`);
    return { success: true, url };
  } catch (err) {
    log('error', `Connection failed: ${err.message}`, err.stack);
    gremlinClient = null;
    connectionUrl = null;
    throw err;
  }
}

function disconnectFromNeptune() {
  if (gremlinClient) {
    log('info', 'Disconnecting from Neptune...');
    try {
      gremlinClient.close();
    } catch (e) {
      log('error', 'Error during disconnect:', e.message);
    }
    gremlinClient = null;
    connectionUrl = null;
    log('info', 'Disconnected');
  }
}

async function executeGremlinQuery(query) {
  if (!gremlinClient) {
    throw new Error('Not connected to Neptune. Please connect first.');
  }

  log('info', `Executing query: ${query}`);

  try {
    const resultSet = await gremlinClient.submit(query, {});
    const results = resultSet.toArray();

    log('info', `Query returned ${results.length} results`);
    log('info', 'Raw result sample:', JSON.stringify(results.slice(0, 3), null, 2));

    return results;
  } catch (err) {
    log('error', `Query execution failed: ${err.message}`, err.stack);
    throw err;
  }
}

// --- IPC Handlers ---

ipcMain.handle('connect', async (event, { endpoint, port, useSsl }) => {
  try {
    const result = await connectToNeptune(endpoint, port, useSsl);
    return { success: true, message: `Connected to ${result.url}` };
  } catch (err) {
    log('error', 'IPC connect error:', err.message);
    return { success: false, message: err.message || 'Failed to connect' };
  }
});

ipcMain.handle('disconnect', async () => {
  disconnectFromNeptune();
  return { success: true, message: 'Disconnected' };
});

ipcMain.handle('execute-query', async (event, query) => {
  try {
    const startTime = Date.now();
    const results = await executeGremlinQuery(query);
    console.log('results :::::::: ', JSON.stringify(results, null, 2));
    const duration = Date.now() - startTime;

    // Safely serialize results
    let serialized;
    try {
      serialized = JSON.parse(JSON.stringify(results));
    } catch (serErr) {
      log('error', 'Failed to serialize results:', serErr.message);
      serialized = results.map(r => String(r));
    }

    return {
      success: true,
      data: serialized,
      duration,
      count: results.length,
    };
  } catch (err) {
    log('error', 'IPC execute-query error:', err.message, err.stack);
    return { success: false, message: err.message || 'Query execution failed' };
  }
});

ipcMain.handle('get-schema', async () => {
  log('info', 'Fetching schema...');
  try {
    const vertexLabels = await executeGremlinQuery('g.V().label().dedup()');
    const edgeLabels = await executeGremlinQuery('g.E().label().dedup()');
    const vertexProps = await executeGremlinQuery('g.V().properties().key().dedup()');
    const edgeProps = await executeGremlinQuery('g.E().properties().key().dedup()');

    const schema = {
      vertexLabels,
      edgeLabels,
      vertexProperties: vertexProps,
      edgeProperties: edgeProps,
    };

    log('info', 'Schema loaded:', JSON.stringify(schema, null, 2));

    return { success: true, data: schema };
  } catch (err) {
    log('error', 'IPC get-schema error:', err.message, err.stack);
    return { success: false, message: err.message || 'Failed to fetch schema' };
  }
});

ipcMain.handle('get-connection-status', async () => {
  return { connected: gremlinClient !== null, url: connectionUrl };
});
