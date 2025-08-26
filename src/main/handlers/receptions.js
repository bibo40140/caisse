// src/main/handlers/receptions.js
const db = require('../db/db');
const receptionsDb = require('../db/receptions');

// Normalise un tableau de lignes quelconque (items / lignes / produits…)
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input.map(l => {
    const produitId = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
    const quantite  = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);
    const puRaw     = (l.prix_unitaire ?? l.pu ?? l.price);
    const prixUnitaire = (puRaw === '' || puRaw == null) ? null : Number(puRaw);

    return { produit_id: produitId, quantite, prix_unitaire: prixUnitaire };
  }).filter(l =>
    Number.isFinite(l.produit_id) && l.produit_id > 0 &&
    Number.isFinite(l.quantite)   && l.quantite   > 0
  );
}

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

  // Handler commun (on l’enregistre sous 2 noms)
  const handleCreate = (event, payload = {}) => {
    try {
      const reception = normalizeReceptionHeader(payload.reception ? payload.reception : payload);
      const lignesRaw = payload.lignes ?? payload.items ?? payload.produits ?? payload.lines ?? [];
      const lignes = normalizeLignes(lignesRaw);

      if (!Number.isFinite(reception.fournisseur_id) || reception.fournisseur_id <= 0) {
        throw new Error('fournisseur_id manquant ou invalide');
      }
      if (lignes.length === 0) {
        throw new Error('aucune ligne de réception');
      }

      const id = receptionsDb.enregistrerReception(reception, lignes);
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
  ipcMain.handle('receptions:list', (event, opts) => {
    try { return receptionsDb.getReceptions(opts || {}); }
    catch (e) { console.error('[ipc] receptions:list ERROR:', e?.message || e); return []; }
  });

  // Détails (si utilisé)
  ipcMain.handle('receptions:get', (event, receptionId) => {
    try { return receptionsDb.getDetailsReception(receptionId); }
    catch (e) { console.error('[ipc] receptions:get ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });
}

module.exports = { registerReceptionHandlers };
