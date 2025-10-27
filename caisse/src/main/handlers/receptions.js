// src/main/handlers/receptions.js
const db = require('../db/db');
const receptionsDb = require('../db/receptions');

// (optionnel) module de synchro main
let syncMod = null;
try {
  // S'il existe, on l'utilise pour déclencher un push→pull en arrière-plan
  syncMod = require('../sync');
} catch (_) {
  // pas bloquant
}

/**
 * Normalise un tableau de lignes quelconque (items / lignes / produits…)
 * - produit_id : id numérique requis
 * - quantite   : > 0
 * - prix_unitaire : PU appliqué si fourni (nombre), sinon null (le module DB prendra le prix courant)
 * - stock_corrige : optionnel — si fourni dans la ligne (stockCorrige ou stock_corrige), on le propage
 */
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((l) => {
      const produitId = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
      const quantite  = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);

      // PU appliqué si fourni (sinon null -> "pas de changement de prix")
      const puRaw = (l.prix_unitaire ?? l.pu ?? l.price);
      const prixUnitaire =
        puRaw === '' || puRaw == null
          ? null
          : (Number.isFinite(Number(puRaw)) ? Number(puRaw) : null);

      // Support stock corrigé (optionnel) s'il est fourni par l'UI de réception
      let stockCorrige = null;
      if (l.stockCorrige != null && l.stockCorrige !== '') {
        const v = Number(l.stockCorrige);
        if (Number.isFinite(v)) stockCorrige = v;
      } else if (l.stock_corrige != null && l.stock_corrige !== '') {
        const v = Number(l.stock_corrige);
        if (Number.isFinite(v)) stockCorrige = v;
      }

      return {
        produit_id: produitId,
        quantite,
        prix_unitaire: prixUnitaire,
        stock_corrige: stockCorrige,
      };
    })
    .filter(
      (l) =>
        Number.isFinite(l.produit_id) &&
        l.produit_id > 0 &&
        Number.isFinite(l.quantite) &&
        l.quantite > 0
    );
}

/**
 * Normalise l'entête de réception.
 * Accepte fournisseur_id / fournisseurId / supplier_id / supplierId
 * Référence libre (string ou null)
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
  console.log('[handlers/receptions] registering IPC handlers');

  const handleCreate = (_event, payload = {}) => {
    console.group('[DEBUG main] receptions:create - payload reçu');
    console.log('payload.reception:', payload?.reception || '(inline header)');
    console.log('payload.lignes/items/lines count:',
      Array.isArray(payload?.lignes) ? payload.lignes.length
      : Array.isArray(payload?.items) ? payload.items.length
      : Array.isArray(payload?.produits) ? payload.produits.length
      : Array.isArray(payload?.lines) ? payload.lines.length
      : 0
    );
    console.groupEnd();

    try {
      const headerRaw = payload.reception ? payload.reception : payload;
      const reception = normalizeReceptionHeader(headerRaw);

      const lignesRaw =
        payload.lignes ?? payload.items ?? payload.produits ?? payload.lines ?? [];
      const lignes = normalizeLignes(lignesRaw);

      if (!Number.isFinite(reception.fournisseur_id) || reception.fournisseur_id <= 0) {
        throw new Error('fournisseur_id manquant ou invalide');
      }
      if (lignes.length === 0) {
        throw new Error('aucune ligne de réception');
      }

      // Écriture locale (DB + ops_queue)
      const id = receptionsDb.enregistrerReception(reception, lignes);

      // 🔄 Déclenche une synchro en arrière-plan si dispo (non bloquant)
      try {
        if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
          setImmediate(() => {
            syncMod.triggerBackgroundSync().catch(() => {});
          });
        }
      } catch (_) {
        // on ignore les erreurs de sync pour ne pas bloquer l'UX réception
      }

      return { ok: true, receptionId: id };
    } catch (e) {
      console.error('[ipc] receptions:create ERROR:', e?.message || e);
      throw e;
    }
  };

  // Nom “moderne”
  ipcMain.handle('receptions:create', handleCreate);
  // Alias pour ta UI actuelle
  ipcMain.handle('enregistrer-reception', handleCreate);

  // Liste (si utilisé)
  ipcMain.handle('receptions:list', (_event, opts) => {
    try {
      return receptionsDb.getReceptions(opts || {});
    } catch (e) {
      console.error('[ipc] receptions:list ERROR:', e?.message || e);
      return [];
    }
  });

  // Détails (si utilisé)
  ipcMain.handle('receptions:get', (_event, receptionId) => {
    try {
      return receptionsDb.getDetailsReception(receptionId);
    } catch (e) {
      console.error('[ipc] receptions:get ERROR:', e?.message || e);
      return { header: null, lignes: [] };
    }
  });
}

module.exports = { registerReceptionHandlers };
