// src/main/db/fournisseurs.js
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, '../../../coopaz.db');
const db = new Database(dbPath);

// 🔄 GET
function getFournisseurs() {
  return db.prepare(`
    SELECT f.*,
           c.nom AS categorie_nom,
           a.nom || ' ' || a.prenom AS referent_nom
    FROM fournisseurs f
    LEFT JOIN categories c ON f.categorie_id = c.id
    LEFT JOIN adherents a ON f.referent_id = a.id
  `).all();
}



// ➕ Ajouter
function ajouterFournisseur(f) {
  const stmt = db.prepare(`INSERT INTO fournisseurs 
    (nom, contact, email, telephone, adresse, code_postal, ville, categorie, referent, label) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(f.nom, f.contact, f.email, f.telephone, f.adresse, f.code_postal, f.ville, f.categorie, f.referent, f.label);
}

// ✏️ Modifier
function modifierFournisseur(f) {
  const stmt = db.prepare(`UPDATE fournisseurs SET 
    nom = ?, contact = ?, email = ?, telephone = ?, 
    adresse = ?, code_postal = ?, ville = ?, categorie_id = ?, 
    referent_id = ?, label = ? WHERE id = ?`);
  stmt.run(
    f.nom, f.contact, f.email, f.telephone,
    f.adresse, f.code_postal, f.ville,
    f.categorie_id ? parseInt(f.categorie_id) : null,
    f.referent_id ? parseInt(f.referent_id) : null,
    f.label,
    f.id
  );
}


// ❌ Supprimer
function supprimerFournisseur(id) {
  db.prepare('DELETE FROM fournisseurs WHERE id = ?').run(id);
}

// 🔍 Rechercher par nom
function rechercherFournisseurParNom(nom) {
  const row = db.prepare(`
    SELECT * FROM fournisseurs WHERE LOWER(nom) = LOWER(?) LIMIT 1
  `).get(nom.trim());
  return row || null;
}

// 🔁 Résoudre conflit (Remplacer / Modifier)
function resoudreConflitFournisseur(action, nouveau, existantId) {
  const update = db.prepare(`
    UPDATE fournisseurs SET
      nom = ?, email = ?, telephone = ?, adresse = ?, code_postal = ?, ville = ?, referent = ?, categorie_id = ?
    WHERE id = ?
  `);

  const insert = db.prepare(`
    INSERT INTO fournisseurs (nom, email, telephone, adresse, code_postal, ville, referent, categorie_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (action === 'Remplacer') {
    update.run(
      nouveau.nom, nouveau.email, nouveau.telephone, nouveau.adresse,
      nouveau.code_postal, nouveau.ville, nouveau.referent,
      nouveau.categorie_id ? parseInt(nouveau.categorie_id) : null,
      existantId
    );
    return "Remplacé";
  }

  if (action === 'Modifier') {
    insert.run(
      nouveau.nom, nouveau.email, nouveau.telephone, nouveau.adresse,
      nouveau.code_postal, nouveau.ville, nouveau.referent,
      nouveau.categorie_id ? parseInt(nouveau.categorie_id) : null
    );
    return "Ajouté avec modification";
  }

  return "Ignoré";
}

module.exports = {
  getFournisseurs,
  ajouterFournisseur,
  modifierFournisseur,
  supprimerFournisseur,
  rechercherFournisseurParNom,
  resoudreConflitFournisseur
};
