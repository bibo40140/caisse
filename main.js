// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
// ⬇️ on importe aussi pullAll et pushOpsNow (utilisés plus bas)
const { hydrateOnStartup, pullAll, pushOpsNow } = require('./src/main/sync');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function readConfig() {
  try {
    const p = path.join(app.getAppPath(), 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return { modules: {} }; }
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

// === Handlers existants ===
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
require('./src/main/handlers/adherents')(ipcMain);

if (config.modules.cotisations)  require('./src/main/handlers/cotisations');
if (config.modules.imports !== false) require('./src/main/handlers/imports');
if (config.modules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}
if (config.modules.email || config.modules.emails) require('./src/main/handlers/email')(ipcMain);

// ============================================================================
// Fallback / Normalisation IPC pour Ventes & Réceptions
// (assure la présence des canaux utilisés par le renderer)
// ============================================================================
const ventesDB = require('./src/main/db/ventes');
const receptionsDB = require('./src/main/db/receptions');

function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

// Historique des ventes (Paramètres > Historique des ventes)
safeHandle('get-historique-ventes', async (_e, filters) => {
  try { return ventesDB.getHistoriqueVentes(filters || {}); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Détail d’une vente
safeHandle('get-details-vente', async (_e, venteId) => {
  try { return ventesDB.getDetailsVente(venteId); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Historique des réceptions (Paramètres > Historique réception)
safeHandle('get-receptions', async (_e, paging) => {
  try { return receptionsDB.getReceptions(paging || {}); }
  catch (err) { throw new Error(err?.message || String(err)); }
});

// Détail d’une réception — le renderer attend SEULEMENT le tableau de lignes
safeHandle('get-details-reception', async (_e, receptionId) => {
  try {
    const r = receptionsDB.getDetailsReception(receptionId);
    return r?.lignes || []; // ⬅️ renvoyer le tableau directement
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
});

// Enregistrer une réception (Page Réception) + push ops immédiat vers Neon
safeHandle('enregistrer-reception', async (_e, reception) => {
  try {
    // ⬇️ PASSER 2 ARGUMENTS (reception, reception.lignes)
    const id = receptionsDB.enregistrerReception(reception, reception?.lignes || []);
    try { await pushOpsNow(DEVICE_ID); } catch (_) {}
    return id; // l’UI accepte id / {success:true} / true
  } catch (err) {
    throw new Error(err?.message || String(err));
  }
});


// (Optionnel) pousser manuellement les opérations en attente
safeHandle('ops:push-now', async () => {
  try {
    const r = await pushOpsNow(DEVICE_ID);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});



// ============================================================================
// Fallback IPC — Modes de paiement (mp:*)
// ============================================================================
function boolToInt(b) { return b ? 1 : 0; }

// Assure l'existence de la table si besoin
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS modes_paiement (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      taux_percent REAL DEFAULT 0,
      frais_fixe REAL DEFAULT 0,
      actif INTEGER DEFAULT 1
    )
  `).run();
} catch (e) {
  console.error('[mp] create table error:', e?.message || e);
}

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
    const nom = String(payload?.nom || '').trim();
    const taux = Number(payload?.taux_percent || 0);
    const fixe = Number(payload?.frais_fixe || 0);
    const actif = boolToInt(!!payload?.actif);

    if (!nom) throw new Error('Nom requis');

    const stmt = db.prepare(`
      INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
      VALUES (?, ?, ?, ?)
    `);
    const r = stmt.run(nom, taux, fixe, actif);
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
// en bas de main.js (ou près des autres ipcMain.handle)
const ventesDb = require('./src/main/db/ventes');

try { ipcMain.removeHandler('get-historique-ventes'); } catch {}
try { ipcMain.removeHandler('get-details-vente'); } catch {}

ipcMain.handle('get-historique-ventes', async (_e, filters) => {
  try { return ventesDb.getHistoriqueVentes(filters || {}); }
  catch (err) { console.error('[ipc] get-historique-ventes', err); return []; }
});

ipcMain.handle('get-details-vente', async (_e, venteId) => {
  try { return ventesDb.getDetailsVente(venteId); }
  catch (err) { console.error('[ipc] get-details-vente', err); return { header:null, lignes:[] }; }
});