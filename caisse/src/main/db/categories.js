// src/main/db/categories.js
'use strict';
const db = require('./db');

/* ---------------- Families ---------------- */
function getFamilies() {
  return db.prepare(`SELECT id, nom FROM familles ORDER BY nom COLLATE NOCASE`).all();
}
function createFamily(nom) {
  const name = String(nom || '').trim();
  if (!name) throw new Error('Nom requis');
  const r = db.prepare(`INSERT OR IGNORE INTO familles(nom) VALUES (?)`).run(name);
  // retrieve (existing or newly created)
  const row = db.prepare(`SELECT id, nom FROM familles WHERE nom = ?`).get(name);
  return row;
}
function renameFamily(id, nom) {
  const name = String(nom || '').trim();
  const fid = Number(id);
  if (!fid) throw new Error('ID requis');
  if (!name) throw new Error('Nom requis');
  db.prepare(`UPDATE familles SET nom = ? WHERE id = ?`).run(name, fid);
  return { id: fid, nom: name };
}
function deleteFamily(id) {
  const fid = Number(id);
  if (!fid) throw new Error('ID requis');
  // set categories.famille_id to NULL (schema already ON DELETE SET NULL)
  db.prepare(`DELETE FROM familles WHERE id = ?`).run(fid);
  return { ok: true };
}

/* ---------------- Categories ---------------- */
function getCategoriesAllDetailed() {
  return db.prepare(`
    SELECT c.id, c.nom, c.famille_id, f.nom AS famille_nom
    FROM categories c
    LEFT JOIN familles f ON f.id = c.famille_id
    ORDER BY f.nom COLLATE NOCASE NULLS FIRST, c.nom COLLATE NOCASE
  `).all();
}

function getCategoryTree() {
  // Families
  const fams = db.prepare(`SELECT id, nom FROM familles ORDER BY nom COLLATE NOCASE`).all();
  // Categories grouped by famille_id
  const cats = db.prepare(`
    SELECT id, nom, famille_id
    FROM categories
    ORDER BY nom COLLATE NOCASE
  `).all();

  const byFam = new Map();
  for (const f of fams) byFam.set(f.id, { id: f.id, nom: f.nom, categories: [] });

  // categories with famille
  for (const c of cats) {
    if (c.famille_id && byFam.has(c.famille_id)) {
      byFam.get(c.famille_id).categories.push({ id: c.id, nom: c.nom, famille_id: c.famille_id });
    }
  }

  // families list
  const families = Array.from(byFam.values());

  // categories without family (orphans)
  const orphans = cats.filter(c => !c.famille_id).map(c => ({ id: c.id, nom: c.nom, famille_id: null }));

  return { families, orphans };
}

function getCategoriesByFamily(familleId) {
  const fid = Number(familleId);
  if (!fid) return [];
  return db.prepare(`
    SELECT id, nom, famille_id
    FROM categories
    WHERE famille_id = ?
    ORDER BY nom COLLATE NOCASE
  `).all(fid);
}

function createCategory(nom, familleId = null) {
  const name = String(nom || '').trim();
  if (!name) throw new Error('Nom requis');

  let fid = null;
  if (familleId != null && familleId !== '') {
    const n = Number(familleId);
    if (Number.isInteger(n)) fid = n;
  }

  db.prepare(`INSERT OR IGNORE INTO categories(nom, famille_id) VALUES (?, ?)`).run(name, fid);
  // fetch row back (unique on (nom, famille_id))
  const row = db.prepare(`
    SELECT id, nom, famille_id
    FROM categories
    WHERE nom = ? AND ( (famille_id IS NULL AND ? IS NULL) OR (famille_id = ?) )
    ORDER BY id DESC
    LIMIT 1
  `).get(name, fid, fid);
  return row;
}

function renameCategory(id, nom) {
  const name = String(nom || '').trim();
  const cid = Number(id);
  if (!cid) throw new Error('ID requis');
  if (!name) throw new Error('Nom requis');
  db.prepare(`UPDATE categories SET nom = ? WHERE id = ?`).run(name, cid);
  return { id: cid, nom: name };
}

function setCategoryFamily(id, familleId = null) {
  const cid = Number(id);
  if (!cid) throw new Error('ID requis');

  let fid = null;
  if (familleId != null && familleId !== '') {
    const n = Number(familleId);
    if (Number.isInteger(n)) fid = n;
  }
  db.prepare(`UPDATE categories SET famille_id = ? WHERE id = ?`).run(fid, cid);
  return { id: cid, famille_id: fid };
}

function deleteCategory(id) {
  const cid = Number(id);
  if (!cid) throw new Error('ID requis');
  // schema has FK on produits.categorie_id (ON DELETE CASCADE? → in your schema it's plain FK; we just delete)
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(cid);
  return { ok: true };
}

/* -------- Aliases for legacy calls -------- */
function getAllCategories() {
  return db.prepare(`SELECT id, nom FROM categories ORDER BY nom COLLATE NOCASE`).all();
}
function getCategoriesProduits() {
  // Historically used by “produits” screens
  return getCategoriesAllDetailed();
}

module.exports = {
  // families
  getFamilies,
  createFamily,
  renameFamily,
  deleteFamily,
  // categories
  getCategoryTree,
  getCategoriesAllDetailed,
  getCategoriesByFamily,
  createCategory,
  renameCategory,
  setCategoryFamily,
  deleteCategory,
  // legacy aliases
  getAllCategories,
  getCategoriesProduits,
};
