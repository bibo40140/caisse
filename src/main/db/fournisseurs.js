// src/main/db/fournisseurs.js
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '../../../coopaz.db');
const db = require('./db');

// 🔄 GET
function getFournisseurs() {
  return db.prepare(`
    SELECT f.*,
           c.nom AS categorie_nom,
           (a.nom || ' ' || a.prenom) AS referent_nom
    FROM fournisseurs f
    LEFT JOIN categories c ON f.categorie_id = c.id
    LEFT JOIN adherents  a ON f.referent_id = a.id
    ORDER BY f.nom ASC
  `).all();
}

// ➕ Ajouter
function ajouterFournisseur(f) {
  const stmt = db.prepare(`
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    f.nom,
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    f.categorie_id ? parseInt(f.categorie_id, 10) : null,
    f.referent_id ? parseInt(f.referent_id, 10) : null,
    f.label || null
  );
}

// ✏️ Modifier
function modifierFournisseur(f) {
  const stmt = db.prepare(`
    UPDATE fournisseurs SET
      nom = ?, contact = ?, email = ?, telephone = ?,
      adresse = ?, code_postal = ?, ville = ?,
      categorie_id = ?, referent_id = ?, label = ?
    WHERE id = ?
  `);
  stmt.run(
    f.nom,
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    f.categorie_id ? parseInt(f.categorie_id, 10) : null,
    f.referent_id ? parseInt(f.referent_id, 10) : null,
    f.label || null,
    parseInt(f.id, 10)
  );
}

// ❌ Supprimer
function supprimerFournisseur(id) {
  db.prepare(`DELETE FROM fournisseurs WHERE id = ?`).run(id);
}

// 🔍 Rechercher par nom (exact, insensible à la casse)
function rechercherFournisseurParNom(nom) {
  return db.prepare(`
    SELECT * FROM fournisseurs
    WHERE LOWER(nom) = LOWER(?)
    LIMIT 1
  `).get(String(nom || '').trim()) || null;
}

// 🔁 Résoudre conflit (Remplacer / Ajouter / Ignorer)
function resoudreConflitFournisseur(action, nouveau, existantId) {
  const update = db.prepare(`
    UPDATE fournisseurs SET
      nom = ?, contact = ?, email = ?, telephone = ?,
      adresse = ?, code_postal = ?, ville = ?,
      categorie_id = ?, referent_id = ?, label = ?
    WHERE id = ?
  `);

  const insert = db.prepare(`
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (action === 'remplacer' || action === 'Remplacer') {
    update.run(
      nouveau.nom,
      nouveau.contact || null,
      nouveau.email || null,
      nouveau.telephone || null,
      nouveau.adresse || null,
      nouveau.code_postal || null,
      nouveau.ville || null,
      nouveau.categorie_id ? parseInt(nouveau.categorie_id, 10) : null,
      nouveau.referent_id ? parseInt(nouveau.referent_id, 10) : null,
      nouveau.label || null,
      parseInt(existantId, 10)
    );
    return 'Remplacé';
  }

  if (action === 'ajouter' || action === 'Ajouter') {
    insert.run(
      nouveau.nom,
      nouveau.contact || null,
      nouveau.email || null,
      nouveau.telephone || null,
      nouveau.adresse || null,
      nouveau.code_postal || null,
      nouveau.ville || null,
      nouveau.categorie_id ? parseInt(nouveau.categorie_id, 10) : null,
      nouveau.referent_id ? parseInt(nouveau.referent_id, 10) : null,
      nouveau.label || null
    );
    return 'Ajouté';
  }

  return 'Ignoré';
}

module.exports = {
  getFournisseurs,
  ajouterFournisseur,
  modifierFournisseur,
  supprimerFournisseur,
  rechercherFournisseurParNom,
  resoudreConflitFournisseur,
};
