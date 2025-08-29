// src/main/db/adherents.js
const db = require('./db');

function getAdherents(archive = 0) {
  return db.prepare('SELECT * FROM adherents WHERE archive = ? ORDER BY nom, prenom').all(archive);
}

function ajouterAdherent(data) {
  const stmt = db.prepare(`
    INSERT INTO adherents 
      (nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville, nb_personnes_foyer, tranche_age, archive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  stmt.run(
    data.nom, data.prenom, data.email1, data.email2, data.telephone1,
    data.telephone2, data.adresse, data.code_postal, data.ville,
    data.nb_personnes_foyer, data.tranche_age
  );
}

function modifierAdherent(data) {
  const stmt = db.prepare(`
    UPDATE adherents SET 
      nom = ?, prenom = ?, email1 = ?, email2 = ?, telephone1 = ?, telephone2 = ?,
      adresse = ?, code_postal = ?, ville = ?, nb_personnes_foyer = ?, tranche_age = ?
    WHERE id = ?
  `);
  stmt.run(
    data.nom, data.prenom, data.email1, data.email2, data.telephone1,
    data.telephone2, data.adresse, data.code_postal, data.ville,
    data.nb_personnes_foyer, data.tranche_age, data.id
  );
}

function archiverAdherent(id) {
  db.prepare(`UPDATE adherents SET archive = 1, date_archivage = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

function reactiverAdherent(id) {
  db.prepare(`UPDATE adherents SET archive = 0, date_reactivation = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

module.exports = {
  getAdherents,
  ajouterAdherent,
  modifierAdherent,
  archiverAdherent,
  reactiverAdherent
};
