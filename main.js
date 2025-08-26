// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
const { hydrateOnStartup } = require('./src/main/sync');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function readConfig() {
  try {
    const p = path.join(app.getAppPath(), 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch(_) { return { modules: {} }; }
}
const config = readConfig();

function createWindow () {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });
  win.maximize();
  win.loadFile('index.html');
  win.show();
}

app.whenReady().then(async () => {
  console.log('[main] app ready — DEVICE_ID =', DEVICE_ID);

// Désactive le push complet au démarrage si SKIP_BOOTSTRAP=1
  if (process.env.SKIP_BOOTSTRAP !== '1') {
    try {
      const r = await runBootstrap();
      console.log('[bootstrap] OK:', r);
    } catch (e) {
      console.error('[bootstrap] ERROR:', e?.message || e);
    }
  } else {
    console.log('[bootstrap] SKIPPED (env SKIP_BOOTSTRAP=1)');
  }

  // Désactive le pull (hydratation) au démarrage si SKIP_HYDRATE=1
  if (process.env.SKIP_HYDRATE !== '1') {
    try {
      const r = await hydrateOnStartup();
      console.log('[hydrate] OK:', r);
    } catch (e) {
      console.error('[hydrate] ERROR:', e?.message || e);
    }
  } else {
    console.log('[hydrate] SKIPPED (env SKIP_HYDRATE=1)');
  }

  createWindow();
});

// === IPC : Push/Pull TOUT pour la page Paramètres ===
ipcMain.handle('sync:push-all', async () => {
  try {
    const r = await runBootstrap();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('sync:pull-all', async () => {
  try {
    const r = await pullAll();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Handlers
require('./src/main/handlers/config')(ipcMain);
require('./src/main/handlers/produits');
require('./src/main/handlers/unites')(ipcMain);
require('./src/main/handlers/modules');

const registerVentesHandlers = require('./src/main/handlers/ventes');
registerVentesHandlers(ipcMain);

const registerProspectsHandlers = require('./src/main/handlers/prospects');
registerProspectsHandlers(ipcMain);

const { registerCategoryHandlers } = require('./src/main/handlers/categories');
registerCategoryHandlers();

if (config.modules.fournisseurs) require('./src/main/handlers/fournisseurs')();
if (config.modules.adherents)    require('./src/main/handlers/adherents')(ipcMain);
else ipcMain.handle('get-adherents', () => []);

if (config.modules.cotisations)  require('./src/main/handlers/cotisations');
if (config.modules.imports !== false) require('./src/main/handlers/imports');
if (config.modules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}
if (config.modules.email || config.modules.emails) require('./src/main/handlers/email')(ipcMain);
if (config.modules.modes_paiement !== false) require('./src/main/handlers/modes_paiement');
