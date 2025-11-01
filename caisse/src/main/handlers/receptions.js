// src/main/handlers/receptions.js
const receptionsDb = require('../db/receptions');

// (optionnel) module de synchro main
let syncMod = null;
try {
  syncMod = require('../sync');
} catch { /* non bloquant */ }

// Canaux centralisés
const CHANNELS = {
  create: 'receptions:create',
  createAlias: 'enregistrer-reception',
  list: 'receptions:list',
  get: 'receptions:get',
};

// Empêche l’enregistrement multiple
let alreadyRegistered = false;

/**
 * Normalise un tableau de lignes (items / lignes / produits…)
 */
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((l) => {
      const produitId = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
      const quantite  = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);

      const puRaw = (l.prix_unitaire ?? l.pu ?? l.price);
      const prixUnitaire =
        puRaw === '' || puRaw == null
          ? null
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
    .filter(
      (l) =>
        Number.isFinite(l.produit_id) && l.produit_id > 0 &&
        Number.isFinite(l.quantite)   && l.quantite > 0
    );
}

/**
 * Normalise l’entête de réception.
 */
function normalizeReceptionHeader(raw = {}) {
  const fournisseur_id =
    raw.fournisseur_id ?? raw.fournisseurId ?? raw.supplier_id ?? raw.supplierId;
  return {
    fournisseur_id: Number(fournisseur_id),
    reference: raw.reference ?? raw.ref ?? null,
  };
}

function registerReceptionHandlers(ipcMain) {
  // Nettoyage préventif (idempotence)
  try { ipcMain.removeHandler(CHANNELS.create); } catch {}
  try { ipcMain.removeHandler(CHANNELS.createAlias); } catch {}
  try { ipcMain.removeHandler(CHANNELS.list); } catch {}
  try { ipcMain.removeHandler(CHANNELS.get); } catch {}

  if (!alreadyRegistered) {
    console.log('[handlers/receptions] registering IPC handlers');
  } else {
    console.log('[handlers/receptions] re-registering IPC handlers (hot reload)');
  }

  const handleCreate = (_event, payload = {}) => {
    try {
      const headerRaw = payload.reception ? payload.reception : payload;
      const reception = normalizeReceptionHeader(headerRaw);

      const lignesRaw = payload.lignes ?? payload.items ?? payload.produits ?? payload.lines ?? [];
      const lignes = normalizeLignes(lignesRaw);

      if (!Number.isFinite(reception.fournisseur_id) || reception.fournisseur_id <= 0) {
        throw new Error('fournisseur_id manquant ou invalide');
      }
      if (lignes.length === 0) {
        throw new Error('aucune ligne de réception');
      }

      const id = receptionsDb.enregistrerReception(reception, lignes);

      // Sync best-effort en arrière-plan
      try {
        if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
          setImmediate(() => { syncMod.triggerBackgroundSync().catch(() => {}); });
        }
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

  ipcMain.handle(CHANNELS.list, (_event, opts) => {
    try { return receptionsDb.getReceptions(opts || {}); }
    catch (e) { console.error('[ipc] receptions:list ERROR:', e?.message || e); return []; }
  });

  ipcMain.handle(CHANNELS.get, (_event, receptionId) => {
    try { return receptionsDb.getDetailsReception(receptionId); }
    catch (e) { console.error('[ipc] receptions:get ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });

  alreadyRegistered = true;
}

module.exports = { registerReceptionHandlers };
