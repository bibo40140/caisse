// src/main/db/stock.js
const db = require('./db');

// Normalise une quantité (nombre >= 0)
function _toPosNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

// 🔽 Décrémenter le stock d’un produit (ex : vente)
function decrementerStock(produitId, quantite) {
  const q = _toPosNumber(quantite);
  if (!q) return; // rien à faire
  const stmt = db.prepare(`UPDATE produits SET stock = stock - ? WHERE id = ?`);
  stmt.run(q, Number(produitId));
}

// 🔼 Incrémenter le stock (ex : retour produit)
function incrementerStock(produitId, quantite) {
  const q = _toPosNumber(quantite);
  if (!q) return;
  const stmt = db.prepare(`UPDATE produits SET stock = stock + ? WHERE id = ?`);
  stmt.run(q, Number(produitId));
}

// 🔄 Mettre à jour le stock à une valeur fixe
function mettreAJourStock(produitId, quantite) {
  const q = Number(quantite);
  if (!Number.isFinite(q)) return;
  const stmt = db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`);
  stmt.run(q, Number(produitId));
}

// 🔍 Obtenir le stock actuel d’un produit
function getStock(produitId) {
  const row = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(Number(produitId));
  return row ? row.stock : null;
}

// 🔁 Réinitialiser tout le stock (ex : inventaire complet)
function reinitialiserStock() {
  db.prepare(`UPDATE produits SET stock = 0`).run();
}

// ——— Aliases pour compatibilité ———
// Certains modules appellent decrementStock / incrementStock
const decrementStock = decrementerStock;
const incrementStock = incrementerStock;

module.exports = {
  // noms “historiques”
  decrementerStock,
  incrementerStock,
  mettreAJourStock,
  getStock,
  reinitialiserStock,
  // aliases compatibles
  decrementStock,
  incrementStock,
};
