// src/main/db/ventes.js
const db = require('./db');

// Ajouter une vente
function enregistrerVente(vente) {
  const insertVente = db.prepare(`
    INSERT INTO ventes (date_vente, total, adherent_id)
    VALUES (datetime('now'), ?, ?)
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix)
    VALUES (?, ?, ?, ?)
  `);

  const insertCotisation = db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertVente.run(vente.total, vente.adherent_id);
    const venteId = result.lastInsertRowid;

    if (vente.lignes && Array.isArray(vente.lignes)) {
      for (const ligne of vente.lignes) {
        insertLigne.run(venteId, ligne.produit_id, ligne.quantite, ligne.prix);
      }
    }

    if (vente.cotisation && vente.cotisation > 0) {
      const datePaiement = new Date().toISOString().slice(0, 10); // ex: '2025-08-08'
      const mois = datePaiement.slice(0, 7); // ex: '2025-08'
      insertCotisation.run(vente.adherent_id, vente.cotisation, datePaiement, mois);
    }

    return venteId;
  });

  return transaction();
}

// Obtenir toutes les ventes
function getVentes() {
  return db.prepare(`
    SELECT v.id, v.date, v.total, v.mode_paiement, a.nom || ' ' || a.prenom AS adherent
    FROM ventes v
    LEFT JOIN adherents a ON v.adherent_id = a.id
    ORDER BY v.date DESC
  `).all();
}

// Obtenir le détail d’une vente
function getDetailsVente(venteId) {
  return db.prepare(`
    SELECT 
      lv.quantite, lv.prix, p.nom AS produit, 
      f.nom AS fournisseur, u.nom AS unite
    FROM lignes_vente lv
    JOIN produits p ON lv.produit_id = p.id
    LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id
    LEFT JOIN unites u ON p.unite_id = u.id
    WHERE lv.vente_id = ?
  `).all(venteId);
}

module.exports = {
  enregistrerVente,
  getVentes,
  getDetailsVente
};
