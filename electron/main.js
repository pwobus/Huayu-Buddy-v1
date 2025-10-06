const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, shell } = require('electron');

const SERVER_PORT = Number(process.env.PORT) || 8787;
let mainWindow;
let serverInstance;
let isQuitting = false;

const isDev = !app.isPackaged;

const resolveServerModule = () => {
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  return pathToFileURL(serverPath).href;
};

const startServer = async () => {
  if (serverInstance) return serverInstance;
  const serverModule = await import(resolveServerModule());
  const createServer = serverModule.createServer || serverModule.default;
  if (typeof createServer !== 'function') {
    throw new Error('createServer export not found in server/index.js');
  }

  serverInstance = await createServer({
    port: SERVER_PORT,
    serveUi: !process.env.ELECTRON_START_URL,
    quiet: !isDev,
  });

  return serverInstance;
};

const stopServer = async () => {
  if (!serverInstance) return;
  await new Promise((resolve) => {
    serverInstance.close((err) => {
      if (err) {
        console.error('[electron] error closing server', err);
      }
      resolve();
    });
  });
  serverInstance = undefined;
};

const createWindow = async () => {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0b1120',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const startUrl = process.env.ELECTRON_START_URL || `http://localhost:${SERVER_PORT}`;
  await mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
};

app.on('ready', async () => {
  try {
    await createWindow();
  } catch (err) {
    console.error('[electron] failed to launch', err);
    app.quit();
  }
});

app.on('activate', async () => {
  if (!mainWindow) {
    await createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (!serverInstance || isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  try {
    await stopServer();
  } catch (err) {
    console.error('[electron] failed to close server', err);
  } finally {
    app.exit();
  }
});
