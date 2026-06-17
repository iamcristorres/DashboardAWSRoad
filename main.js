const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8765;
const API_HOST = 'avansat-log360.intrared.net';
const API_BASE_PATH = '/api/v1';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

let mainWindow;
let localServer;

function getAssetsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, 'assets');
}

// Proxy una peticion a la API de produccion
function proxyToApi(req, res) {
  const parsed = url.parse(req.url);
  const targetPath = API_BASE_PATH + parsed.pathname.replace(API_BASE_PATH, '') +
    (parsed.query ? '?' + parsed.query : '');

  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['host'];
  delete forwardHeaders['origin'];
  delete forwardHeaders['referer'];
  forwardHeaders['host'] = API_HOST;
  forwardHeaders['accept'] = forwardHeaders['accept'] || 'application/json';

  const options = {
    hostname: API_HOST,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Error conectando con la API: ' + err.message }));
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// Sirve un archivo estatico desde la carpeta assets
function serveStatic(req, res) {
  let pathname = url.parse(req.url).pathname;
  if (pathname === '/') pathname = '/testing_dashboard.html';

  const filePath = path.join(getAssetsDir(), pathname.split('/').join(path.sep));
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No encontrado: ' + pathname);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function startLocalServer() {
  localServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
      res.end();
      return;
    }

    if (req.url.startsWith(API_BASE_PATH)) {
      proxyToApi(req, res);
    } else {
      serveStatic(req, res);
    }
  });

  localServer.listen(PORT, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: `Dashboard GPS v${app.getVersion()}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenu(null);

  // La pagina tiene su propio <title>; lo sobreescribimos para mantener la version visible
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(`Dashboard GPS v${app.getVersion()}`);
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/testing_dashboard.html`);

  // Ajustar zoom para que el contenido se vea proporcional al navegador
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(0.80);
  });
}

function setupAutoUpdater() {
  // En desarrollo no verificar actualizaciones
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualizacion disponible',
      message: `Hay una nueva version del Dashboard GPS disponible (v${info.version}).`,
      detail: 'Deseas descargarla e instalarla ahora?',
      buttons: ['Instalar ahora', 'Mas tarde'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    console.error('Error verificando actualizaciones:', err.message);
  });

  // Verificar al iniciar y cada 4 horas
  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  startLocalServer();
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  app.quit();
});
