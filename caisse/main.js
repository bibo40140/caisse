// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// === Auth & API config (NOUVEAU) ===
const { ensureAuth, getConfig } = require('./src/main/config');     // getConfig = SYNCHRONE
const { setAuthToken, setApiBase } = require('./src/main/apiClient');

// === App modules existants ===
const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
const sync = require('./src/main/sync'); // expose: hydrateOnStartup, pullAll, pushOpsNow, startAutoSync

// ============================================================================
// Fenêtre
// ============================================================================
function createWindow() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true,
    },
  });
  win.maximize();
  win.loadFile('index.html');
  win.show();
}

// ============================================================================
// Démarrage appli
// ============================================================================
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

app.whenReady().then(async () => {
  console.log('[main] app ready — DEVICE_ID =', DEVICE_ID);

  // 1) Charger la config (SYNCHRONE) et initialiser l’API client
  let cfg;
  try {
    cfg = getConfig(); // synchrone, lit config.json
  } catch (e) {
    console.warn('[config] lecture impossible:', e?.message || e);
    cfg = { modules: {} };
  }
  const base = (cfg.api_base_url || '').replace(/\/+$/, '');
  if (base) setApiBase(base);

  // 2) Authentification : utiliser token existant OU login via api_email/api_password
  let auth = { ok: false, error: 'no config' };
  try {
    auth = await ensureAuth(); // essaie d’utiliser auth_token, sinon tente /auth/login
  } catch (e) {
    console.error('[auth] ensureAuth error:', e?.message || e);
  }
  if (auth.ok && auth.token) {
    setAuthToken(auth.token);
    if (auth.tenant_id) process.env.TENANT_ID = auth.tenant_id;
    process.env.API_AUTH_TOKEN = auth.token; // compat modules legacy lisant process.env
    console.log('[auth] OK — tenant =', auth.tenant_id || '(inconnu)');
  } else {
    console.warn('[auth] Pas de token API — les appels protégés seront ignorés jusqu’à connexion.');
  }

  // 3) Lancer la sync auto (une seule fois)
  try {
    sync.startAutoSync(DEVICE_ID);
  } catch (e) {
    console.warn('[sync] startAutoSync warning:', e?.message || e);
  }

  // 4) Bootstrap (local -> Neon) au démarrage (optionnel)
  if (process.env.SKIP_BOOTSTRAP !== '1') {
    if (auth.ok) {
      try {
        const r = await runBootstrap();
        console.log('[bootstrap] OK:', r);
      } catch (e) {
        console.error('[bootstrap] ERROR:', e?.message || e);
      }
    } else {
      console.log('[bootstrap] SKIPPED (pas de token)');
    }
  } else {
    console.log('[bootstrap] SKIPPED (env SKIP_BOOTSTRAP=1)');
  }

  // 5) Hydratation (Neon -> local) au démarrage (optionnel)
  if (process.env.SKIP_HYDRATE !== '1') {
    if (auth.ok) {
      try {
        const r = await sync.hydrateOnStartup();
        console.log('[hydrate] OK:', r);
      } catch (e) {
        console.error('[hydrate] ERROR:', e?.message || e);
      }
    } else {
      console.log('[hydrate] SKIPPED (pas de token)');
    }
  } else {
    console.log('[hydrate] SKIPPED (env SKIP_HYDRATE=1)');
  }

  createWindow();
});

// ============================================================================
// IPC utilitaires (petite aide pour factoriser)
// ============================================================================
function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

// ============================================================================
// IPC exposés au renderer : sync push/pull (avec garde auth)
// ============================================================================
safeHandle('sync:pushBootstrapRefs', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.pushBootstrapRefs(); // { ok, counts }
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

// ============================================================================
// IPC “boutons Paramètres” (compat) : push/pull TOUT
// ============================================================================
safeHandle('sync:push-all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    const r = await runBootstrap();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('sync:pull-all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    const r = await sync.pullAll();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ============================================================================
// Handlers existants (ne pas toucher)
// ============================================================================
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

// === chargements conditionnels selon la config (SYNCHRONE)
let cfgModules = {};
try {
  const c = getConfig(); // synchrone
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

// ============================================================================
// Fallbacks “modes de paiement” (inchangés — utilisés par la caisse + admin)
// ============================================================================
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

// Liste (vue caisse) : uniquement actifs
safeHandle('mp:getAll', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      WHERE actif = 1
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
});

// Liste (admin) : tous
safeHandle('mp:getAllAdmin', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
});

// Création
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
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
});

// Mise à jour
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
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
});

// Suppression
safeHandle('mp:remove', async (_e, id) => {
  try {
    const n = Number(id);
    if (!n) throw new Error('ID requis');
    db.prepare(`DELETE FROM modes_paiement WHERE id = ?`).run(n);
    return { ok: true };
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
});
