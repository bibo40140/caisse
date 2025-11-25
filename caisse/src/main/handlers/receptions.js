// src/main/handlers/receptions.js (MAIN PROCESS)
const receptionsDb = require('../db/receptions');
const { BrowserWindow } = require('electron');

// (optionnel) module de synchro main
let syncMod = null;
try { syncMod = require('../sync'); } catch { /* non bloquant */ }

// Canaux centralisés
const CHANNELS = {
  create: 'receptions:create',
  createAlias: 'enregistrer-reception',
  list: 'receptions:list',
  get: 'receptions:get',
};

// Empêche l’enregistrement multiple
let alreadyRegistered = false;

/** Normalise les lignes reçues depuis le renderer */
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((l) => {
      const produitId = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
      const quantite  = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);

      const puRaw = (l.prix_unitaire ?? l.pu ?? l.price);
      const prixUnitaire =
        puRaw === '' || puRaw == null ? null
        : (Number.isFinite(Number(puRaw)) ? Number(puRaw) : null);

      let stockCorrige = null;
      if (l.stockCorrige != null && l.stockCorrige !== '') {
        const v = Number(l.stockCorrige);
        if (Number.isFinite(v)) stockCorrige = v;
      } else if (l.stock_corrige != null && l.stock_corrige !== '') {
        const v = Number(l.stock_corrige);
        if (Number.isFinite(v)) stockCorrige = v;
      }

      return { produit_id: produitId, quantite, prix_unitaire: prixUnitaire, stock_corrige: stockCorrige };
    })
    .filter((l) =>
      Number.isFinite(l.produit_id) && l.produit_id > 0 &&
      Number.isFinite(l.quantite)   && l.quantite > 0
    );
}

/** Normalise l'entête */
function normalizeReceptionHeader(raw = {}) {
  const fournisseur_id =
    raw.fournisseur_id ?? raw.fournisseurId ?? raw.supplier_id ?? raw.supplierId;
  // ✅ Si null/undefined/NaN/0, on met null (pas de fournisseur)
  const fid = Number(fournisseur_id);
  return {
    fournisseur_id: (Number.isFinite(fid) && fid > 0) ? fid : null,
    reference: raw.reference ?? raw.ref ?? null,
  };
}

function registerReceptionHandlers(ipcMain) {
  // Idempotence (hot reload)
  try { ipcMain.removeHandler(CHANNELS.create); } catch {}
  try { ipcMain.removeHandler(CHANNELS.createAlias); } catch {}
  try { ipcMain.removeHandler(CHANNELS.list); } catch {}
  try { ipcMain.removeHandler(CHANNELS.get); } catch {}
  // 🔧 nettoie aussi l’ancien canal pour éviter le warning
  try { ipcMain.removeHandler('get-receptions'); } catch {}

  console.log(`[handlers/receptions] ${alreadyRegistered ? 're-registering' : 'registering'} IPC handlers`);

  const handleCreate = (_event, payload = {}) => {
    try {
      const headerRaw = payload.reception ? payload.reception : payload;
      const reception = normalizeReceptionHeader(headerRaw);

      const lignesRaw = payload.lignes ?? payload.items ?? payload.produits ?? payload.lines ?? [];
      const lignes = normalizeLignes(lignesRaw);

      // ✅ Accepter fournisseur_id = null (pas de fournisseur) si module désactivé
      // Validation : soit null, soit un nombre > 0
      const fid = reception.fournisseur_id;
      if (fid !== null && (!Number.isFinite(fid) || fid <= 0)) {
        throw new Error('fournisseur_id invalide (doit être null ou > 0)');
      }
      if (lignes.length === 0) throw new Error('aucune ligne de réception');

      const id = receptionsDb.enregistrerReception(reception, lignes);

      // Best-effort: trigger sync en arrière-plan
      try {
      // Best-effort: trigger sync en arrière-plan
try {
  if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
    setImmediate(() => {
      try {
        syncMod.triggerBackgroundSync();
      } catch (e) {
        console.warn('[sync] triggerBackgroundSync error (receptions):', e.message || e);
      }
    });
  }
} catch {}

      } catch {}

       // 🔔 Notifie les renderer d’un refresh des données
      try {
        BrowserWindow.getAllWindows().forEach(w => {
          w.webContents.send('data:refreshed', { from: 'reception:create', ts: Date.now() });
        });
      } catch {}

      return { ok: true, receptionId: id };
    } catch (e) {
      console.error('[ipc] receptions:create ERROR:', e?.message || e);
      throw e;
    }
  };

  // Handlers
  ipcMain.handle(CHANNELS.create, handleCreate);
  ipcMain.handle(CHANNELS.createAlias, handleCreate);

  // Liste (nouveau canal)
  ipcMain.handle(CHANNELS.list, (_event, opts) => {
    try { return receptionsDb.getReceptions(opts || {}); }
    catch (e) { console.error('[ipc] receptions:list ERROR:', e?.message || e); return []; }
  });

  // Détails
  ipcMain.handle(CHANNELS.get, (_event, receptionId) => {
    try { return receptionsDb.getDetailsReception(receptionId); }
    catch (e) { console.error('[ipc] receptions:get ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });

  // 🧷 ALIAS legacy pour compatibilité avec ton renderer actuel
  // Certaines vues appellent encore 'get-receptions' → renvoyer la LISTE
  // Nom “moderne”
  // ✅ alias legacy attendu par ta page
  ipcMain.handle('get-receptions', (_event, opts) => {
    try { return receptionsDb.getReceptions(opts || {}); }
    catch (e) { console.error('[ipc] get-receptions ERROR:', e?.message || e); return []; }
  });

  // ✅ alias legacy attendu par ta page
  ipcMain.handle('get-details-reception', (_event, receptionId) => {
    try { return receptionsDb.getDetailsReception(receptionId); }
    catch (e) { console.error('[ipc] get-details-reception ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });


  alreadyRegistered = true;
}

module.exports = { registerReceptionHandlers };
