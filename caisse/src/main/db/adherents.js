// src/main/db/adherents.js
const db = require('./db');

function ensureDefaultsLocal() {
  try {
    // Unités
    try {
      const cntU = db.prepare(`SELECT COUNT(*) AS n FROM unites`).get();
      if (!cntU || Number(cntU.n) === 0) {
        const insU = db.prepare(`INSERT INTO unites (nom) VALUES (?)`);
        ['kg', 'litre', 'pièce'].forEach(u => {
          try { insU.run(u); } catch {}
        });
      }
    } catch {}

    // Famille / catégorie minimal
    try {
      const cntC = db.prepare(`SELECT COUNT(*) AS n FROM categories`).get();
      if (!cntC || Number(cntC.n) === 0) {
        try { db.prepare(`INSERT INTO familles (nom) VALUES (?)`).run('Général'); } catch {}
        const fam = db.prepare(`SELECT id FROM familles WHERE nom = ? LIMIT 1`).get('Général');
        const famId = fam && fam.id ? fam.id : null;
        const insCat = db.prepare(`INSERT INTO categories (nom, famille_id) VALUES (?, ?)`);
        ['Divers'].forEach(c => {
          try { insCat.run(c, famId); } catch {}
        });
      }
    } catch {}

    // Modes de paiement
    try {
      const cntM = db.prepare(`SELECT COUNT(*) AS n FROM modes_paiement`).get();
      if (!cntM || Number(cntM.n) === 0) {
        const insM = db.prepare(`INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif) VALUES (?, ?, ?, ?)`);
        const defaults = [ ['Espèces',0,0,1], ['CB',0,0,1], ['Chèque',0,0,1], ['Virement',0,0,1] ];
        defaults.forEach(m => { try { insM.run(m[0], m[1], m[2], m[3]); } catch {} });
      }
    } catch {}
  } catch (e) {
    // non bloquant
    console.warn('[ensureDefaultsLocal] erreur seed local', e?.message || e);
  }
}

function getAdherents(archive = 0) {
  return db
    .prepare('SELECT * FROM adherents WHERE archive = ? ORDER BY nom, prenom')
    .all(Number(archive) || 0);
}

/**
 * Ajoute un adhérent en base locale et retourne l’objet créé avec son id.
 */
function ajouterAdherent(data) {
  // ensure minimal reference data exists locally so UI can show defaults
  try { ensureDefaultsLocal(); } catch (e) { /* non bloquant */ }
  const stmt = db.prepare(`
    INSERT INTO adherents 
      (nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age, statut, archive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'actif'), 0)
  `);

  const info = stmt.run(
    data.nom || null,
    data.prenom || null,
    data.email1 || null,
    data.email2 || null,
    data.telephone1 || null,
    data.telephone2 || null,
    data.adresse || null,
    data.code_postal || null,
    data.ville || null,
    data.nb_personnes_foyer || null,
    data.tranche_age || null,
    data.statut || 'actif'
  );

  const id = info.lastInsertRowid;

  return {
    id,
    nom: data.nom || null,
    prenom: data.prenom || null,
    email1: data.email1 || null,
    email2: data.email2 || null,
    telephone1: data.telephone1 || null,
    telephone2: data.telephone2 || null,
    adresse: data.adresse || null,
    code_postal: data.code_postal || null,
    ville: data.ville || null,
    nb_personnes_foyer: data.nb_personnes_foyer || null,
    tranche_age: data.tranche_age || null,
    statut: data.statut || 'actif',
    archive: 0,
  };
}

function modifierAdherent(data) {
  const stmt = db.prepare(`
    UPDATE adherents SET 
      nom = ?, prenom = ?, email1 = ?, email2 = ?, telephone1 = ?, telephone2 = ?,
      adresse = ?, code_postal = ?, ville = ?, nb_personnes_foyer = ?, tranche_age = ?,
      statut = COALESCE(?, 'actif')
    WHERE id = ?
  `);
  stmt.run(
    data.nom || null,
    data.prenom || null,
    data.email1 || null,
    data.email2 || null,
    data.telephone1 || null,
    data.telephone2 || null,
    data.adresse || null,
    data.code_postal || null,
    data.ville || null,
    data.nb_personnes_foyer || null,
    data.tranche_age || null,
    data.statut || 'actif',
    data.id
  );

  // on retourne au moins l'id, pratique côté handler
  return { id: data.id };
}

function archiverAdherent(id) {
  db.prepare(
    `UPDATE adherents 
        SET archive = 1, date_archivage = CURRENT_TIMESTAMP 
      WHERE id = ?`
  ).run(id);
}

function reactiverAdherent(id) {
  db.prepare(
    `UPDATE adherents 
        SET archive = 0, date_reactivation = CURRENT_TIMESTAMP 
      WHERE id = ?`
  ).run(id);
}

module.exports = {
  getAdherents,
  ajouterAdherent,
  modifierAdherent,
  archiverAdherent,
  reactiverAdherent,
};
