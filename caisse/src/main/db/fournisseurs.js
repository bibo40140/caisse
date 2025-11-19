// src/main/db/fournisseurs.js
const db = require('./db');

function asIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Liste complète des fournisseurs (pour l’UI) */
function getFournisseurs() {
  return db
    .prepare(
      `
      SELECT
        f.id,
        f.nom,
        f.contact,
        f.email,
        f.telephone,
        f.adresse,
        f.code_postal,
        f.ville,
        f.categorie_id,
        f.referent_id,
        f.label,
        c.nom AS categorie_nom,
        CASE
          WHEN a.nom IS NOT NULL THEN a.nom || ' ' || COALESCE(a.prenom, '')
          ELSE NULL
        END AS referent
      FROM fournisseurs f
      LEFT JOIN categories c ON c.id = f.categorie_id
      LEFT JOIN adherents a ON a.id = f.referent_id
      ORDER BY f.nom
      `
    )
    .all();
}


/** Ajout local d’un fournisseur */
function ajouterFournisseur(f = {}) {
  const categorieId = asIntOrNull(f.categorie_id ?? f.categorieId);
  const referentId  = asIntOrNull(f.referent_id ?? f.referentId);

  const stmt = db.prepare(`
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville,
       categorie_id, referent_id, label)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  const info = stmt.run(
    f.nom || '',
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    categorieId,
    referentId,
    f.label || null
  );

  const id = info.lastInsertRowid;

  return {
    id,
    nom: f.nom || '',
    contact: f.contact || null,
    email: f.email || null,
    telephone: f.telephone || null,
    adresse: f.adresse || null,
    code_postal: f.code_postal || null,
    ville: f.ville || null,
    categorie_id: categorieId,
    referent_id: referentId,
    label: f.label || null,
  };
}

/** Modification locale d’un fournisseur */
function modifierFournisseur(f = {}) {
  const id = asIntOrNull(f.id);
  if (!id) throw new Error('modifierFournisseur: id requis');

  const categorieId = asIntOrNull(f.categorie_id ?? f.categorieId);
  const referentId  = asIntOrNull(f.referent_id ?? f.referentId);

  const stmt = db.prepare(`
    UPDATE fournisseurs
       SET nom         = ?,
           contact     = ?,
           email       = ?,
           telephone   = ?,
           adresse     = ?,
           code_postal = ?,
           ville       = ?,
           categorie_id = ?,
           referent_id  = ?,
           label        = ?
     WHERE id = ?
  `);

  stmt.run(
    f.nom || '',
    f.contact || null,
    f.email || null,
    f.telephone || null,
    f.adresse || null,
    f.code_postal || null,
    f.ville || null,
    categorieId,
    referentId,
    f.label || null,
    id
  );

  return {
    id,
    nom: f.nom || '',
    contact: f.contact || null,
    email: f.email || null,
    telephone: f.telephone || null,
    adresse: f.adresse || null,
    code_postal: f.code_postal || null,
    ville: f.ville || null,
    categorie_id: categorieId,
    referent_id: referentId,
    label: f.label || null,
  };
}

function supprimerFournisseur(id) {
  const i = asIntOrNull(id);
  if (!i) return;
  db.prepare(`DELETE FROM fournisseurs WHERE id = ?`).run(i);
}

function rechercherFournisseurParNom(nom) {
  const name = String(nom || '').trim();
  if (!name) return null;
  return db
    .prepare(
      `
      SELECT
        f.id,
        f.nom,
        f.contact,
        f.email,
        f.telephone,
        f.adresse,
        f.code_postal,
        f.ville,
        f.categorie_id,
        f.referent_id,
        f.label,
        c.nom AS categorie_nom,
        CASE
          WHEN a.nom IS NOT NULL THEN a.nom || ' ' || COALESCE(a.prenom, '')
          ELSE NULL
        END AS referent
      FROM fournisseurs f
      LEFT JOIN categories c ON c.id = f.categorie_id
      LEFT JOIN adherents a ON a.id = f.referent_id
      WHERE LOWER(f.nom) = LOWER(?)
      LIMIT 1
      `
    )
    .get(name);
}


/**
 * Utilisé par ton UI quand tu gères les conflits de noms.
 * Pour l’instant on laisse la logique minimaliste.
 */
function resoudreConflitFournisseur(action, nouveau, existantId) {
  if (action === 'merge' && existantId) {
    // on pourrait fusionner les infos ici si besoin
    return { mergedInto: existantId };
  }
  if (action === 'create') {
    return ajouterFournisseur(nouveau);
  }
  return null;
}

module.exports = {
  getFournisseurs,
  ajouterFournisseur,
  modifierFournisseur,
  supprimerFournisseur,
  rechercherFournisseurParNom,
  resoudreConflitFournisseur,
};
