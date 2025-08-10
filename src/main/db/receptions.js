// src/main/db/receptions.js
const db = require('./db');

// Enregistrer une réception
function enregistrerReception(reception) {
  const insertReception = db.prepare(`
    INSERT INTO receptions (fournisseur_id, date, reference)
    VALUES (?, datetime('now'), ?)
  `);
  const insertLigne = db.prepare(`
    INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire)
    VALUES (?, ?, ?, ?)
  `);
  const updateStock = db.prepare(`
    UPDATE produits SET stock = stock + ? WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    const result = insertReception.run(reception.fournisseur_id, reception.reference);
    const receptionId = result.lastInsertRowid;

    for (const ligne of reception.lignes) {
      insertLigne.run(receptionId, ligne.produit_id, ligne.quantite, ligne.prix_unitaire);
      updateStock.run(ligne.quantite, ligne.produit_id);
    }

    return receptionId;
  });

  return transaction();
}

// Obtenir toutes les réceptions
function getReceptions() {
  return db.prepare(`
    SELECT r.id, r.date, r.reference, f.nom AS fournisseur
    FROM receptions r
    LEFT JOIN fournisseurs f ON r.fournisseur_id = f.id
    ORDER BY r.date DESC
  `).all();
}

// Obtenir les détails d’une réception
function getDetailsReception(receptionId) {
  return db.prepare(`
    SELECT lr.quantite, lr.prix_unitaire, p.nom AS produit, u.nom AS unite
    FROM lignes_reception lr
    JOIN produits p ON lr.produit_id = p.id
    LEFT JOIN unites u ON p.unite_id = u.id
    WHERE lr.reception_id = ?
  `).all(receptionId);
}

module.exports = {
  enregistrerReception,
  getReceptions,
  getDetailsReception
};
