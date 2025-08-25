// src/main/db/categories.js
const db = require('./db');

// ---- Lectures ----
function getFamilies() {
  return db.prepare(`SELECT id, nom FROM familles ORDER BY nom`).all();
}

function getCategoriesAllDetailed() {
  return db.prepare(`
    SELECT c.id, c.nom, c.famille_id, f.nom AS famille_nom
    FROM categories c
    LEFT JOIN familles f ON f.id = c.famille_id
    ORDER BY f.nom, c.nom
  `).all();
}

function getCategoriesByFamily(familleId) {
  return db.prepare(`
    SELECT id, nom FROM categories
    WHERE famille_id = ?
    ORDER BY nom
  `).all(familleId);
}

function getCategoryTree() {
  const fams = getFamilies();
  const byFam = db.prepare(`SELECT id, nom FROM categories WHERE famille_id = ? ORDER BY nom`);
  return fams.map(f => ({
    id: f.id, nom: f.nom,
    categories: byFam.all(f.id)
  }));
}

/** Catégories réellement utilisées par des produits (avec famille) */
function getCategoriesProduits() {
  return db.prepare(`
    SELECT DISTINCT c.id, c.nom, c.famille_id, f.nom AS famille_nom
    FROM produits p
    JOIN categories c ON c.id = p.categorie_id
    LEFT JOIN familles f ON f.id = c.famille_id
    ORDER BY f.nom, c.nom
  `).all();
}

/** API historique (sans famille) */
function getAllCategories() {
  return db.prepare(`SELECT id, nom FROM categories ORDER BY nom`).all();
}

// ---- Écritures (familles) ----
function createFamily(nom) {
  const stmt = db.prepare(`INSERT INTO familles (nom) VALUES (?)`);
  const info = stmt.run(String(nom).trim());
  return { id: info.lastInsertRowid, nom: String(nom).trim() };
}

function renameFamily(id, nom) {
  db.prepare(`UPDATE familles SET nom = ? WHERE id = ?`).run(String(nom).trim(), Number(id));
  return true;
}

function deleteFamily(id) {
  // On autorise la suppression : les catégories fille passent à famille_id = NULL
  db.prepare(`UPDATE categories SET famille_id = NULL WHERE famille_id = ?`).run(Number(id));
  db.prepare(`DELETE FROM familles WHERE id = ?`).run(Number(id));
  return true;
}

// ---- Écritures (catégories) ----
function createCategory(nom, familleId = null) {
  const info = db.prepare(`INSERT INTO categories (nom, famille_id) VALUES (?, ?)`)
    .run(String(nom).trim(), familleId ? Number(familleId) : null);
  return { id: info.lastInsertRowid, nom: String(nom).trim(), famille_id: familleId || null };
}

function renameCategory(id, nom) {
  db.prepare(`UPDATE categories SET nom = ? WHERE id = ?`).run(String(nom).trim(), Number(id));
  return true;
}

function setCategoryFamily(id, familleId = null) {
  db.prepare(`UPDATE categories SET famille_id = ? WHERE id = ?`)
    .run(familleId ? Number(familleId) : null, Number(id));
  return true;
}

function deleteCategory(id) {
  // sécurité: ref produit/fournisseur?
  const usedProd = db.prepare(`SELECT COUNT(*) AS n FROM produits WHERE categorie_id = ?`).get(Number(id)).n;
  const usedFour = db.prepare(`SELECT COUNT(*) AS n FROM fournisseurs WHERE categorie_id = ?`).get(Number(id)).n;
  if (usedProd || usedFour) {
    return { ok:false, reason:'used', produits: usedProd, fournisseurs: usedFour };
  }
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(Number(id));
  return { ok:true };
}

module.exports = {
  // lecture
  getFamilies,
  getCategoriesAllDetailed,
  getCategoriesByFamily,
  getCategoryTree,
  getCategoriesProduits,
  getAllCategories,
  // écriture
  createFamily, renameFamily, deleteFamily,
  createCategory, renameCategory, deleteCategory, setCategoryFamily,
};
