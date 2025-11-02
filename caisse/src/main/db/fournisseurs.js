// src/main/db/fournisseurs.js

// On accepte deux styles d'export du module ./db :
//  - module.exports = db
//  - module.exports = { db }
let _dbmod = require('./db');
const db = _dbmod?.db || _dbmod;
if (!db || typeof db.prepare !== 'function') {
  throw new Error("[fournisseurs] DB non initialisée : assure-toi que src/main/db/index.js exporte l'instance better-sqlite3 (db) !");
}

// 🔄 Lister
function getFournisseurs() {
  return db
    .prepare(`
      SELECT 
        f.*,
        c.nom AS categorie_nom,
        (a.nom || ' ' || COALESCE(a.prenom, '')) AS referent_nom
      FROM fournisseurs f
      LEFT JOIN categories c ON f.categorie_id = c.id
      LEFT JOIN adherents  a ON f.referent_id = a.id
      ORDER BY f.nom COLLATE NOCASE ASC
    `)
    .all();
}

// ➕ Ajouter (retourne l'id créé)
function ajouterFournisseur(f = {}) {
  const stmt = db.prepare(`
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?,   ?,      ?,     ?,        ?,       ?,          ?,    ?,            ?,           ?)
  `);
  const info = stmt.run(
    (f.nom || '').trim(),
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    f.categorie_id ? Number(f.categorie_id) : null,
    f.referent_id ? Number(f.referent_id) : null,
    f.label || null
  );
  const id = Number(info.lastInsertRowid);
  return { id, ...f, id };
}

// ✏️ Modifier (retourne l'id modifié + echo)
function modifierFournisseur(f = {}) {
  if (!f.id) throw new Error('id requis');
  const stmt = db.prepare(`
    UPDATE fournisseurs SET
      nom = ?, contact = ?, email = ?, telephone = ?,
      adresse = ?, code_postal = ?, ville = ?,
      categorie_id = ?, referent_id = ?, label = ?
    WHERE id = ?
  `);
  stmt.run(
    (f.nom || '').trim(),
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    f.categorie_id ? Number(f.categorie_id) : null,
    f.referent_id ? Number(f.referent_id) : null,
    f.label || null,
    Number(f.id)
  );
  return { id: Number(f.id), ...f, id: Number(f.id) };
}

// ❌ Supprimer
function supprimerFournisseur(id) {
  if (!id) throw new Error('id requis');
  db.prepare(`DELETE FROM fournisseurs WHERE id = ?`).run(Number(id));
  return { ok: true };
}

// 🔍 Rechercher par nom (exact, cas insensible)
function rechercherFournisseurParNom(nom) {
  const row =
    db
      .prepare(
        `SELECT * FROM fournisseurs
         WHERE LOWER(nom) = LOWER(?)
         LIMIT 1`
      )
      .get(String(nom || '').trim()) || null;
  return row;
}

// 🔁 Résolution de conflit (Remplacer / Ajouter / Ignorer)
function resoudreConflitFournisseur(action, nouveau = {}, existantId) {
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
    VALUES (?,   ?,      ?,     ?,        ?,       ?,          ?,    ?,            ?,           ?)
  `);

  const a = String(action || '').toLowerCase();

  if (a === 'remplacer') {
    update.run(
      (nouveau.nom || '').trim(),
      nouveau.contact || null,
      nouveau.email || null,
      nouveau.telephone || null,
      nouveau.adresse || null,
      nouveau.code_postal || null,
      nouveau.ville || null,
      nouveau.categorie_id ? Number(nouveau.categorie_id) : null,
      nouveau.referent_id ? Number(nouveau.referent_id) : null,
      nouveau.label || null,
      Number(existantId)
    );
    return 'Remplacé';
  }

  if (a === 'ajouter') {
    insert.run(
      (nouveau.nom || '').trim(),
      nouveau.contact || null,
      nouveau.email || null,
      nouveau.telephone || null,
      nouveau.adresse || null,
      nouveau.code_postal || null,
      nouveau.ville || null,
      nouveau.categorie_id ? Number(nouveau.categorie_id) : null,
      nouveau.referent_id ? Number(nouveau.referent_id) : null,
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
