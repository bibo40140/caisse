const db = require('./db');
const fs = require('fs');
const path = require('path');
const stockDb = require('./stock'); // ← on le charge une fois ici

// Charger la config pour savoir si le module adhérents est actif
function isModuleActive(moduleName) {
  try {
    const configPath = path.join(__dirname, '..', '..','..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return cfg.modules && cfg.modules[moduleName] === true;
  } catch (err) {
    console.error("Impossible de lire config.json :", err);
    return false;
  }
}

// Ajouter une vente
function enregistrerVente(vente) {
  const adherentsActive = isModuleActive('adherents');

  const insertVente = db.prepare(`
    INSERT INTO ventes (date_vente, total, adherent_id, mode_paiement_id, frais_paiement, sale_type, client_email)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertCotisation = db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const saleType = (vente.sale_type === 'exterieur') ? 'exterieur' : 'adherent';
    const clientEmail = vente.client_email ?? null;
    const adherentId = (adherentsActive && saleType === 'adherent' && vente.adherent_id)
      ? Number(vente.adherent_id)
      : null;

    const res = insertVente.run(
      Number(vente.total || 0),
      adherentId,
      (vente.mode_paiement_id ?? null),
      Number(vente.frais_paiement || 0),
      saleType,
      clientEmail
    );

    const venteId = res.lastInsertRowid;

    if (Array.isArray(vente.lignes)) {
      for (const l of vente.lignes) {
        const puApplique = (l.prix != null) ? Number(l.prix) : Number(l.prix_unitaire || 0);
        const puOrig     = (l.prix_unitaire != null) ? Number(l.prix_unitaire) : Number(l.prix || 0);
        const remisePct  = (l.remise_percent != null) ? Number(l.remise_percent) : 0;

        insertLigne.run(
          venteId,
          Number(l.produit_id),
          Number(l.quantite || 0),
          puApplique,
          puOrig,
          remisePct
        );

        // Décrémenter le stock uniquement si module Stocks actif
        if (isModuleActive('stocks') && Number(l.quantite) > 0) {
          try {
            // Choix de la bonne fonction exportée par stockDb
            const dec =
              stockDb.decrementStock ||
              stockDb.decrementerStock ||
              stockDb.decrement ||
              stockDb.ajusterStock;

            if (typeof dec === 'function') {
              dec(Number(l.produit_id), Number(l.quantite));
            } else {
              console.warn('[STOCK] Aucune fonction de décrément trouvée dans stockDb. Mise à jour du stock ignorée.');
            }
          } catch (err) {
            console.error("Erreur lors de la mise à jour du stock :", err);
            // Ne pas throw → on n'annule pas la vente si la MàJ stock échoue
          }
        }
      }
    }

    // Cotisation uniquement si module adhérents actif, vente adherent, et montant > 0
    if (adherentsActive && saleType === 'adherent' && vente.cotisation && Number(vente.cotisation) > 0) {
      const datePaiement = new Date().toISOString().slice(0, 10);
      const mois = datePaiement.slice(0, 7);
      insertCotisation.run(
        adherentId,
        Number(vente.cotisation),
        datePaiement,
        mois
      );
    }

    // DEBUG TEMP – à retirer après test
    const row = db.prepare(`SELECT id, total, adherent_id, mode_paiement_id, frais_paiement, date_vente
                            FROM ventes WHERE id = ?`).get(venteId);
    console.log('[VENTE INSERTED]', {
      venteId,
      adherentIdUtilise: adherentId,
      mode_paiement_id_recu: (vente.mode_paiement_id ?? null),
      rowEnBase: row
    });

    return venteId;
  });

  return transaction();
}

// Obtenir l’historique des ventes
function getHistoriqueVentes({ from = null, to = null, adherentId = null } = {}) {
  let sql = `
    SELECT
      v.id,
      v.total,
      v.date_vente,
      v.mode_paiement_id,
      mp.nom AS mode_paiement_nom,
      v.frais_paiement,
      v.sale_type,
      v.client_email,
      a.nom    AS adherent_nom,
      a.prenom AS adherent_prenom
    FROM ventes v
    LEFT JOIN adherents a       ON a.id = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE 1=1
  `;
  const params = [];

  if (from)       { sql += ` AND v.date_vente >= ?`; params.push(from); }
  if (to)         { sql += ` AND v.date_vente <= ?`; params.push(to); }
  if (adherentId) { sql += ` AND v.adherent_id = ?`; params.push(adherentId); }

  sql += ` ORDER BY v.date_vente DESC, v.id DESC`;

  const rows = db.prepare(sql).all(...params);
  console.log('[DEBUG getHistoriqueVentes RESULT]', rows);
  return rows;
}

// Détail d’une vente (header + lignes)
function getDetailsVente(venteId) {
  console.log('[DEBUG getDetailsVente] Vente demandée :', venteId);

  const header = db.prepare(`
    SELECT
      v.id,
      v.total,
      v.date_vente,
      v.mode_paiement_id,
      mp.nom AS mode_paiement_nom,
      v.frais_paiement,
      v.sale_type,
      v.client_email,
      a.nom    AS adherent_nom,
      a.prenom AS adherent_prenom,
      a.email1,
      a.email2
    FROM ventes v
    LEFT JOIN adherents a       ON a.id = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE v.id = ?
  `).get(venteId);

  const lignes = db.prepare(`
    SELECT
      lv.id,
      lv.produit_id,
      lv.quantite,
      lv.prix,
      lv.prix_unitaire,
      lv.remise_percent,
      p.nom          AS produit_nom,
      p.code_barre,
      p.unite_id,
      p.fournisseur_id
    FROM lignes_vente lv
    LEFT JOIN produits p ON p.id = lv.produit_id
    WHERE lv.vente_id = ?
    ORDER BY lv.id
  `).all(venteId);

  return { header, lignes };
}

module.exports = {
  enregistrerVente,
  getHistoriqueVentes,
  getDetailsVente
};
