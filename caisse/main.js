// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
const { hydrateOnStartup, pullAll, pushOpsNow, startAutoSync } = require('./src/main/sync');
const sync = require('./src/main/sync');



ipcMain.handle('sync:pushBootstrapRefs', async () => {
  try {
    return await sync.pushBootstrapRefs();   // renvoie { ok, counts }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('sync:push_all', async () => {
  try {
    return await sync.syncPushAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Pull ALL (Neon -> local)
ipcMain.handle('sync:pull_all', async () => {
  try {
    return await sync.pullAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function readConfig() {
  try {
    const p = path.join(app.getAppPath(), 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return { modules: {} };
  }
}
const config = readConfig();

function createWindow() {
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

  // Bootstrap complet (optionnel) au démarrage
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

  // Hydratation (pull) au démarrage
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

  // Auto-push périodique des opérations
  try {
    startAutoSync(DEVICE_ID);
  } catch (e) {
    console.warn('[sync] startAutoSync init warning:', e?.message || e);
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

// === Handlers existants ===
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

if (config.modules.fournisseurs) require('./src/main/handlers/fournisseurs')();
require('./src/main/handlers/adherents')(ipcMain);

if (config.modules.cotisations)  require('./src/main/handlers/cotisations');
if (config.modules.imports !== false) require('./src/main/handlers/imports');
if (config.modules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}
if (config.modules.email || config.modules.emails) require('./src/main/handlers/email')(ipcMain);

// ============================================================================
// Fallback / Normalisation IPC utilitaire
// ============================================================================
function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

// ============================================================================
// Ventes & Réceptions (fallbacks attendus par le renderer)
// ============================================================================
const ventesDB = require('./src/main/db/ventes');
const receptionsDB = require('./src/main/db/receptions');

// Historique des ventes
safeHandle('get-historique-ventes', async (_e, filters) => {
  try { return ventesDB.getHistoriqueVentes(filters || {}); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Détail d’une vente
safeHandle('get-details-vente', async (_e, venteId) => {
  try { return ventesDB.getDetailsVente(venteId); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Historique des réceptions
safeHandle('get-receptions', async (_e, paging) => {
  try { return receptionsDB.getReceptions(paging || {}); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Détail d’une réception — renvoie uniquement le tableau des lignes (contrat renderer)
safeHandle('get-details-reception', async (_e, receptionId) => {
  try {
    const r = receptionsDB.getDetailsReception(receptionId);
    return r?.lignes || [];
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
});

// Enregistrer une réception + push ops immédiat
safeHandle('enregistrer-reception', async (_e, reception) => {
  try {
    const id = receptionsDB.enregistrerReception(reception, reception?.lignes || []);
    try { await pushOpsNow(DEVICE_ID); } catch (_) {}
    return id;
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
});

// Pousser manuellement les opérations en attente
safeHandle('ops:push-now', async () => {
  try {
    const r = await pushOpsNow(DEVICE_ID);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Compter les opérations en attente
safeHandle('ops:pending-count', async () => {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`).get();
    return { pending: r?.n || 0 };
  } catch {
    return { pending: 0 };
  }
});

// ============================================================================
// Modes de paiement (mp:*) — fallback complet (utilisé par la caisse + admin)
// ============================================================================
function boolToInt(b) { return b ? 1 : 0; }

// Assure l'existence de la table (au cas où)
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

// Nettoyage d’anciens handlers s’ils existent
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
