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

// (optionnel) module de synchro main
let syncMod = null;
try {
  // On essaie de charger un module de synchro du main process s'il existe.
  // Idéalement il exporte triggerBackgroundSync() qui fait: push_ops -> pull_refs en arrière-plan.
  syncMod = require('../sync');
} catch (_) {
  // pas bloquant
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

/**
 * Normalise un tableau de lignes vers le format attendu par la DB.
 * Convention DB (cf. src/main/db/ventes.js) :
 *  - lignes_vente.prix         = TOTAL DE LIGNE (PU appliqué × quantité)
 *  - lignes_vente.prix_unitaire= PU APPLIQUÉ (après remise/marge)
 *  - lignes_vente.quantite     = quantité vendue
 */
function normalizeLignes(lignesRaw) {
  const arr = Array.isArray(lignesRaw) ? lignesRaw : [];
  return arr
    .map((l) => {
      const produitId = Number(l.produit_id ?? l.produitId ?? l.id);
      const quantite = Number(l.quantite ?? l.qty ?? l.qte ?? 0);
      const remise = Number(l.remise_percent ?? l.remise ?? 0) || 0;

      const unitRaw = Number(l.prix_unitaire);
      const lineRaw = Number(l.prix);
      const puFallbackRef = Number.isFinite(Number(l.pu)) ? Number(l.pu) : getPrixProduit(produitId);

      let puApplique;
      let prixTotal;

      if (Number.isFinite(unitRaw) && unitRaw > 0 && Number.isFinite(lineRaw) && lineRaw > 0 && quantite > 0) {
        // Nouveau format: prix = total de ligne, prix_unitaire = PU appliqué
        puApplique = unitRaw;
        prixTotal = lineRaw; // déjà le total
      } else if (Number.isFinite(unitRaw) && unitRaw > 0 && quantite > 0) {
        // Unité seulement fournie
        puApplique = unitRaw;
        prixTotal = +(puApplique * quantite).toFixed(4);
      } else if (Number.isFinite(lineRaw) && lineRaw > 0 && quantite > 0) {
        // Ancien format: prix stocke le PU → reconstituer total
        puApplique = lineRaw;
        prixTotal = +(puApplique * quantite).toFixed(4);
      } else if (Number.isFinite(lineRaw) && quantite === 0) {
        // ligneRaw mais quantite incohérente → ignorer
        puApplique = lineRaw;
        prixTotal = 0;
      } else {
        // Fallback DB
        puApplique = puFallbackRef;
        prixTotal = +(puApplique * Math.max(quantite, 0)).toFixed(4);
      }

      return {
        produit_id: produitId,
        quantite,
        prix: prixTotal,
        prix_unitaire: +puApplique.toFixed(4),
        remise_percent: +remise.toFixed(4),
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
      acompte: payload?.acompte,
      mode_paiement_id: payload?.mode_paiement_id,
      sale_type: payload?.sale_type,
      client_email: payload?.client_email
    });
    console.groupEnd();

    try {
      const hasNested = payload && typeof payload.vente === 'object';
      const lignesIn = hasNested
        ? (payload.lignes ?? payload.vente?.lignes ?? payload.items ?? payload.panier ?? [])
        : (payload.lignes ?? payload.items ?? payload.panier ?? []);

      const lignes = normalizeLignes(lignesIn);

      if (lignes.length === 0) {
        console.warn('[DEBUG main] Aucune ligne validée -> payload.lignes =', payload?.lignes);
        throw new Error('aucune ligne de vente');
      }

      const venteIn = hasNested ? { ...(payload.vente || {}) } : { ...payload };

      const adherent_id =
        Number.isFinite(Number(venteIn.adherent_id)) ? Number(venteIn.adherent_id) : null;
      const mode_paiement_id =
        Number.isFinite(Number(venteIn.mode_paiement_id))
          ? Number(venteIn.mode_paiement_id)
          : null;

      const frais_paiement = Number(venteIn.frais_paiement || 0);
      const cotisation = Number(venteIn.cotisation || 0);
      const acompte = Number(venteIn.acompte || 0);
      const sale_type = venteIn.sale_type || (adherent_id ? 'adherent' : 'exterieur');
      const client_email = venteIn.client_email ?? null;

      // ✅ Total produits = somme des TOTAUX DE LIGNE (sans remultiplier la quantité)
      const totalProduits = lignes.reduce((s, l) => s + Number(l.prix || 0), 0);

      const venteObj = {
        total: totalProduits, // côté UI tu affiches total + frais + cotisation si besoin
        adherent_id,
        mode_paiement_id,
        frais_paiement,
        cotisation,
        acompte,
        sale_type,
        client_email,
      };

      const venteId = ventesDb.enregistrerVente(venteObj, lignes);

    // 🔄 Déclenche une synchro en arrière-plan si dispo (non bloquant)
try {
  if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
    setImmediate(() => {
      try {
        syncMod.triggerBackgroundSync();
      } catch (e) {
        console.warn('[sync] triggerBackgroundSync error (ventes):', e.message || e);
      }
    });
  }
} catch (_) {
  // on ignore toute erreur de synchro pour ne pas impacter la vente
}


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
