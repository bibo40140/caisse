// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// === Auth & API config ===
const { ensureAuth, getConfig } = require('./src/main/config');
const { setApiBase, setAuthToken, apiFetch, logout } = require('./src/main/apiClient');

// === App modules existants ===
const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
const sync = require('./src/main/sync'); // hydrateOnStartup, pullAll, pushOpsNow, startAutoSync

// --- Single instance lock (prevents double launch)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ---------------------------
// Windows (only these three)
// ---------------------------
let mainWin = null;
let loginWin = null;
let onboardWin = null;

function createMainWindow() {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });
  mainWin.maximize();
  mainWin.loadFile('index.html');
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { mainWin = null; });
}

function createLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    if (loginWin.isMinimized()) loginWin.restore();
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 420, height: 420, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });
  loginWin.loadFile('src/renderer/login.html');
  loginWin.on('closed', () => { loginWin = null; });
}

function createOnboardingWindow() {
  if (onboardWin && !onboardWin.isDestroyed()) {
    if (onboardWin.isMinimized()) onboardWin.restore();
    onboardWin.focus();
    return;
  }
  onboardWin = new BrowserWindow({
    width: 640, height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });
  onboardWin.loadFile('src/renderer/onboarding.html');
  onboardWin.on('closed', () => { onboardWin = null; });
}

// Second instance: focus any existing window (don’t create a new one)
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  } else {
    // Fallback: open login by default
    createLoginWindow();
  }
});

// macOS: re-open a window if none
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // If we had a token we’ll switch to main later; login is a safe default
    createLoginWindow();
  }
});

// Quit on all closed (except mac)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------
// IPC: Auth / Onboarding flow
// ---------------------------------
ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const js = await r.json();
    if (!r.ok || !js?.token) return { ok: false, error: js?.error || `HTTP ${r.status}` };
    setAuthToken(js.token);
    return { ok: true, token: js.token };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('auth:after-login-route', async () => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status');
    const js = await r.json();
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    const onboarded = !!js.status?.onboarded;
    if (!onboarded) {
      if (loginWin) { loginWin.close(); loginWin = null; }
      createOnboardingWindow();
      return { ok: true, next: 'onboarding' };
    } else {
      if (loginWin) { loginWin.close(); loginWin = null; }
      createMainWindow();
      return { ok: true, next: 'main' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('onboarding:status', async () => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status');
    const js = await r.json();
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, ...js };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('onboarding:submit', async (_e, payload) => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const js = await r.json();
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Déconnexion : purge le token, ferme la fenêtre principale et ouvre la fenêtre de login
ipcMain.handle('auth:logout', async () => {
  try {
    // vide le token (et supprime auth_token du config.json)
    logout();

    // ferme la/les fenêtres "app"
    if (mainWin && !mainWin.isDestroyed()) {
      try { mainWin.close(); } catch {}
      mainWin = null;
    }
    if (onboardWin && !onboardWin.isDestroyed()) {
      try { onboardWin.close(); } catch {}
      onboardWin = null;
    }

    // ouvre la fenêtre de login
    createLoginWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});


ipcMain.handle('app:go-main', async () => {
  if (onboardWin) { onboardWin.close(); onboardWin = null; }
  createMainWindow();
  return { ok: true };
});

// ---------------------------------
// Single startup flow (ONLY ONE)
// ---------------------------------
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

app.whenReady().then(async () => {
  console.log('[main] app ready — DEVICE_ID =', DEVICE_ID);

  // 1) Config → API base
  try {
    const cfg = await getConfig();
    if (cfg?.api_base_url) setApiBase(cfg.api_base_url);
  } catch (e) {
    console.warn('[config] lecture impossible:', e?.message || e);
  }

  // 2) Auth (token or login via config creds)
  let auth = { ok: false };
  try {
    auth = await ensureAuth();
  } catch (e) {
    console.error('[auth] ensureAuth error:', e?.message || e);
  }
  if (auth.ok && auth.token) {
    setAuthToken(auth.token);
    if (auth.tenant_id) process.env.TENANT_ID = auth.tenant_id;
    process.env.API_AUTH_TOKEN = auth.token;
    console.log('[auth] OK — tenant =', auth.tenant_id || '(inconnu)');
  } else {
    console.warn('[auth] Pas de token API — on ouvre la fenêtre de login.');
    createLoginWindow();
    return; // stop here (bootstrap/hydrate will run after login if you want)
  }

  // 3) Auto-sync
  try {
    sync.startAutoSync(DEVICE_ID);
  } catch (e) {
    console.warn('[sync] startAutoSync warning:', e?.message || e);
  }

  // 4) Bootstrap (local -> Neon) if allowed
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

  // 5) Hydrate (Neon -> local) if allowed
  if (process.env.SKIP_HYDRATE !== '1') {
    try {
      const r = await sync.hydrateOnStartup();
      console.log('[hydrate] OK:', r);
    } catch (e) {
      console.error('[hydrate] ERROR:', e?.message || e);
    }
  } else {
    console.log('[hydrate] SKIPPED (env SKIP_HYDRATE=1)');
  }

  // 6) Route to Onboarding or Main
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status');
    const js = await r.json();
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    if (js.status?.onboarded) {
      createMainWindow();
    } else {
      createOnboardingWindow();
    }
  } catch {
    // API KO → on ouvre la main en mode local
    createMainWindow();
  }
});

// ---------------------------------
// IPC utilitaires + handlers existants
// ---------------------------------
function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

safeHandle('sync:pushBootstrapRefs', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.pushBootstrapRefs();
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

safeHandle('sync:push_all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.syncPushAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('sync:pull_all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.pullAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Handlers existants (inchangés)
require('./src/main/handlers/config')(ipcMain);
require('./src/main/handlers/produits');
require('./src/main/handlers/unites')(ipcMain);
require('./src/main/handlers/modules');
require('./src/main/handlers/carts');

const registerVentesHandlers = require('./src/main/handlers/ventes');
registerVentesHandlers(ipcMain);

const registerProspectsHandlers = require('./src/main/handlers/prospects');
registerProspectsHandlers(ipcMain);

const { registerCategoryHandlers } = require('./src/main/handlers/categories');
registerCategoryHandlers();

// chargements conditionnels (synchrone)
let cfgModules = {};
try {
  const c = getConfig(); // if your getConfig is async, replace with a cached config or make a tiny sync reader here
  cfgModules = (c && c.modules) || {};
} catch { cfgModules = {}; }

if (cfgModules.fournisseurs) require('./src/main/handlers/fournisseurs')();
require('./src/main/handlers/adherents')(ipcMain);

if (cfgModules.cotisations)  require('./src/main/handlers/cotisations');
if (cfgModules.imports !== false) require('./src/main/handlers/imports');
if (cfgModules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}
if (cfgModules.email || cfgModules.emails) require('./src/main/handlers/email')(ipcMain);

const registerInventoryHandlers = require('./src/main/handlers/inventory');
registerInventoryHandlers(ipcMain);

// Fallbacks modes de paiement (inchangés)
function boolToInt(b) { return b ? 1 : 0; }
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS modes_paiement (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nom          TEXT UNIQUE NOT NULL,
      taux_percent REAL DEFAULT 0,
      frais_fixe   REAL DEFAULT 0,
      actif        INTEGER DEFAULT 1
    )
  `).run();
} catch (e) {
  console.error('[mp] create table error:', e?.message || e);
}

try { ipcMain.removeHandler('mp:getAll'); } catch {}
try { ipcMain.removeHandler('mp:getAllAdmin'); } catch {}
try { ipcMain.removeHandler('mp:create'); } catch {}
try { ipcMain.removeHandler('mp:update'); } catch {}
try { ipcMain.removeHandler('mp:remove'); } catch {}

safeHandle('mp:getAll', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      WHERE actif = 1
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:getAllAdmin', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:create', async (_e, payload) => {
  try {
    const nom  = String(payload?.nom || '').trim();
    const taux = Number(payload?.taux_percent || 0);
    const fixe = Number(payload?.frais_fixe || 0);
    const actif = boolToInt(!!payload?.actif);
    if (!nom) throw new Error('Nom requis');
    const r = db.prepare(`
      INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
      VALUES (?, ?, ?, ?)
    `).run(nom, taux, fixe, actif);
    return { id: r.lastInsertRowid, nom, taux_percent: taux, frais_fixe: fixe, actif: !!actif };
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:update', async (_e, payload) => {
  try {
    const id   = Number(payload?.id);
    const nom  = String(payload?.nom || '').trim();
    const taux = Number(payload?.taux_percent || 0);
    const fixe = Number(payload?.frais_fixe || 0);
    const actif = boolToInt(!!payload?.actif);
    if (!id) throw new Error('ID requis');
    if (!nom) throw new Error('Nom requis');
    db.prepare(`
      UPDATE modes_paiement
      SET nom = ?, taux_percent = ?, frais_fixe = ?, actif = ?
      WHERE id = ?
    `).run(nom, taux, fixe, actif, id);
    return { id, nom, taux_percent: taux, frais_fixe: fixe, actif: !!actif };
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:remove', async (_e, id) => {
  try {
    const n = Number(id);
    if (!n) throw new Error('ID requis');
    db.prepare(`DELETE FROM modes_paiement WHERE id = ?`).run(n);
    return { ok: true };
  } catch (e) { throw new Error(e?.message || String(e)); }
});
