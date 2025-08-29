const db = require('./db');

function getAll() {
  return db.prepare(`SELECT * FROM modes_paiement WHERE actif = 1 ORDER BY nom`).all();
}
function getAllAdmin() {
  return db.prepare(`SELECT * FROM modes_paiement ORDER BY nom`).all();
}
function create({ nom, taux_percent = 0, frais_fixe = 0, actif = 1 }) {
  return db.prepare(`
    INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif) VALUES (?, ?, ?, ?)
  `).run(nom, Number(taux_percent) || 0, Number(frais_fixe) || 0, actif ? 1 : 0);
}
function update({ id, nom, taux_percent = 0, frais_fixe = 0, actif = 1 }) {
  return db.prepare(`
    UPDATE modes_paiement SET nom=?, taux_percent=?, frais_fixe=?, actif=? WHERE id=?
  `).run(nom, Number(taux_percent) || 0, Number(frais_fixe) || 0, actif ? 1 : 0, id);
}
function remove(id) {
  // soft delete: actif=0 (pour garder l'historique)
  return db.prepare(`UPDATE modes_paiement SET actif=0 WHERE id=?`).run(id);
}

module.exports = { getAll, getAllAdmin, create, update, remove };
