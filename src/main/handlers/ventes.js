// src/main/handlers/ventes.js
const path = require('path');
const db = require('../db/db');

// chemin du module DB ventes
const ventesFile = path.join(__dirname, '..', 'db', 'ventes.js');

let ventesDb;
try {
  ventesDb = require(ventesFile);
} catch (e) {
  console.error('[handlers/ventes] Impossible de charger', ventesFile, e);
  ventesDb = null;
}

// Utilitaires
function getPrixProduit(id) {
  try {
    const row = db.prepare(`SELECT prix FROM produits WHERE id = ?`).get(Number(id));
    return Number(row?.prix || 0);
  } catch {
    return 0;
  }
}

// Normalise un tableau de lignes vers le format attendu par la DB
function normalizeLignes(lignesRaw) {
  const arr = Array.isArray(lignesRaw) ? lignesRaw : [];
  return arr
    .map((l) => {
      const produitId = Number(l.produit_id ?? l.produitId ?? l.id);
      const quantite = Number(l.quantite ?? l.qty ?? l.qte ?? 0);

      const prixUnitaire =
        l.prix_unitaire != null &&
        l.prix_unitaire !== '' &&
        Number.isFinite(Number(l.prix_unitaire))
          ? Number(l.prix_unitaire)
          : Number.isFinite(Number(l.pu))
          ? Number(l.pu)
          : getPrixProduit(produitId);

      let totalLigne =
        l.prix != null && l.prix !== '' ? Number(l.prix) : quantite * prixUnitaire;

      if (!Number.isFinite(totalLigne)) totalLigne = 0;

      const remise = Number(l.remise_percent ?? l.remise ?? 0) || 0;

      return {
        produit_id: produitId,
        quantite,
        prix: totalLigne, // total de la ligne
        prix_unitaire: prixUnitaire, // PU de référence si fourni
        remise_percent: remise,
      };
    })
    .filter(
      (l) =>
        Number.isFinite(l.produit_id) &&
        l.produit_id > 0 &&
        Number.isFinite(l.quantite) &&
        l.quantite > 0 &&
        Number.isFinite(l.prix)
    );
}

module.exports = function registerVentesHandlers(ipcMain) {
  if (!ventesDb || typeof ventesDb.enregistrerVente !== 'function') {
    console.error('[handlers/ventes] ventesDb.enregistrerVente indisponible');
  }

  // Enregistrement d'une vente
  ipcMain.handle('enregistrer-vente', async (_e, payload = {}) => {
    console.group('[DEBUG main] enregistrer-vente - payload reçu');
console.log('payload.lignes length:', Array.isArray(payload?.lignes) ? payload.lignes.length : 'n/a');
console.log('payload.lignes:', payload?.lignes);
console.log('payload.meta:', {
  total: payload?.total,
  adherent_id: payload?.adherent_id,
  cotisation: payload?.cotisation,
  mode_paiement_id: payload?.mode_paiement_id,
  sale_type: payload?.sale_type,
  client_email: payload?.client_email
});
console.groupEnd();

    try {
      const hasNested = payload && typeof payload.vente === 'object';
      const lignesIn = hasNested
        ? payload.lignes ?? payload.vente?.lignes ?? payload.items ?? payload.panier ?? []
        : payload.lignes ?? payload.items ?? payload.panier ?? [];

        console.warn('[DEBUG main] Aucune ligne validée -> payload.lignes =', payload?.lignes);

      const lignes = normalizeLignes(lignesIn);
      if (lignes.length === 0) throw new Error('aucune ligne de vente');

      const venteIn = hasNested ? { ...(payload.vente || {}) } : { ...payload };

      const adherent_id =
        Number.isFinite(Number(venteIn.adherent_id)) ? Number(venteIn.adherent_id) : null;
      const mode_paiement_id =
        Number.isFinite(Number(venteIn.mode_paiement_id))
          ? Number(venteIn.mode_paiement_id)
          : null;

      const frais_paiement = Number(venteIn.frais_paiement || 0);
      const cotisation = Number(venteIn.cotisation || 0); // ⬅️ important
      const sale_type = venteIn.sale_type || (adherent_id ? 'adherent' : 'exterieur');
      const client_email = venteIn.client_email ?? null;

      // total produits (les lignes contiennent déjà le total par ligne)
      const totalProduits = lignes.reduce((s, l) => s + Number(l.prix || 0), 0);

      const venteObj = {
        total: totalProduits, // côté UI on affichera total + frais + cotisation
        adherent_id,
        mode_paiement_id,
        frais_paiement,
        cotisation, // ⬅️ passe bien dans la DB
        sale_type,
        client_email,
      };

      const venteId = ventesDb.enregistrerVente(venteObj, lignes);
      return { ok: true, venteId };
    } catch (e) {
      console.error('[ipc] enregistrer-vente ERROR:', e?.message || e);
      throw e;
    }
  });

  // Historique des ventes
  ipcMain.handle('get-historique-ventes', (_evt, opts) => {
    const vdb = require('../db/ventes');
    return vdb.getHistoriqueVentes(opts || {});
  });

  // Détail d'une vente
  ipcMain.handle('get-details-vente', (_evt, id) => {
    const vdb = require('../db/ventes');
    return vdb.getDetailsVente(Number(id));
  });
};
