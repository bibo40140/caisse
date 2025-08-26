// src/main/handlers/ventes.js
const path = require('path');
const fs = require('fs');
const db = require('../db/db');

// ⚠️ on force le chemin exact vers le fichier CJS
const ventesFile = path.join(__dirname, '..', 'db', 'ventes.js');
console.log('[handlers/ventes] ventes.js expected at:', ventesFile, 'exists:', fs.existsSync(ventesFile));

let ventesDb;
try {
  const resolved = require.resolve(ventesFile);
  console.log('[handlers/ventes] require.resolve =', resolved);
  ventesDb = require(ventesFile);
  console.log('[handlers/ventes] exports =', Object.keys(ventesDb));
} catch (e) {
  console.error('[handlers/ventes] require ventes.js failed:', e && e.message || e);
  ventesDb = {};
}

// utilitaire : prix produit si besoin
function getPrixProduit(produitId) {
  const row = db.prepare('SELECT prix FROM produits WHERE id=?').get(Number(produitId));
  return row ? Number(row.prix || 0) : 0;
}

// normalisation des lignes depuis le front
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input.map(l => {
    const produitId = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
    const quantite  = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);
    const puRaw = (l.prix_unitaire ?? l.pu ?? l.price);
    const prixUnitaire = (puRaw === '' || puRaw == null) ? null : Number(puRaw);
    let prix = l.prix ?? l.total ?? l.prix_total;
    if (prix == null) {
      const base = (prixUnitaire != null && Number.isFinite(prixUnitaire)) ? prixUnitaire : getPrixProduit(produitId);
      prix = Number(quantite) * Number(base);
    }
    const remise = Number(l.remise_percent ?? l.remise ?? 0) || 0;
    return { produit_id: produitId, quantite, prix: Number(prix), prix_unitaire: prixUnitaire, remise_percent: remise };
  }).filter(l =>
    Number.isFinite(l.produit_id) && l.produit_id > 0 &&
    Number.isFinite(l.quantite)   && l.quantite   > 0 &&
    Number.isFinite(l.prix)
  );
}

module.exports = function registerVentesHandlers(ipcMain) {
  ipcMain.handle('enregistrer-vente', (event, payload = {}) => {
    try {
      if (!ventesDb || typeof ventesDb.enregistrerVente !== 'function') {
        throw new Error('ventesDb.enregistrerVente indisponible (export manquant ou erreur au chargement)');
      }
      const vente = payload.vente || {};
      const lignesRaw = payload.lignes ?? payload.lignesVente ?? payload.items ?? payload.panier ?? [];
      const lignes = normalizeLignes(lignesRaw);
      if (lignes.length === 0) throw new Error('aucune ligne de vente');
      if (vente.total == null) vente.total = lignes.reduce((s, l) => s + Number(l.prix || 0), 0);
      const venteId = ventesDb.enregistrerVente(vente, lignes);
      return { ok: true, venteId };
    } catch (e) {
      console.error('[ipc] enregistrer-vente ERROR:', e?.message || e);
      throw e;
    }
  });

  ipcMain.handle('ventes:list', (event, opts) => {
    try { return ventesDb.getHistoriqueVentes(opts || {}); }
    catch (e) { console.error('[ipc] ventes:list ERROR:', e?.message || e); return []; }
  });

  ipcMain.handle('ventes:get', (event, venteId) => {
    try { return ventesDb.getDetailsVente(venteId); }
    catch (e) { console.error('[ipc] ventes:get ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });
};
