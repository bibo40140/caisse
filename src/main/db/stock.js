// src/main/db/stock.js
const db = require('./db');

// 🔽 Décrémenter le stock d’un produit (ex : vente)
function decrementerStock(produitId, quantite) {
  const stmt = db.prepare(`UPDATE produits SET stock = stock - ? WHERE id = ?`);
  stmt.run(quantite, produitId);
}

// 🔼 Incrémenter le stock (ex : retour produit)
function incrementerStock(produitId, quantite) {
  const stmt = db.prepare(`UPDATE produits SET stock = stock + ? WHERE id = ?`);
  stmt.run(quantite, produitId);
}

// 🔄 Mettre à jour le stock à une valeur fixe
function mettreAJourStock(produitId, quantite) {
  const stmt = db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`);
  stmt.run(quantite, produitId);
}

// 🔍 Obtenir le stock actuel d’un produit
function getStock(produitId) {
  const row = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(produitId);
  return row ? row.stock : null;
}

// 🔁 Réinitialiser tout le stock (ex : inventaire complet)
function reinitialiserStock() {
  db.prepare(`UPDATE produits SET stock = 0`).run();
}

module.exports = {
  decrementerStock,
  incrementerStock,
  mettreAJourStock,
  getStock,
  reinitialiserStock
};
