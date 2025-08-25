// src/main/db/cotisations.js
const db = require('./db');

// Récupérer les cotisations avec jointure adhérent
function getCotisations() {
  return db.prepare(`
    SELECT c.*, a.nom, a.prenom
    FROM cotisations c
    LEFT JOIN adherents a ON c.adherent_id = a.id
    ORDER BY c.date_paiement DESC
  `).all();
}

function verifierCotisationAdherent(adherentId) {
  const moisActuel = new Date().toISOString().slice(0, 7); // '2025-08'
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM cotisations
    WHERE adherent_id = ?
    AND strftime('%Y-%m', date_paiement) = ?
  `).get(adherentId, moisActuel);
  
  return result.count > 0;
}

// Ajouter une cotisation
function ajouterCotisation(adherentId, montant) {
  const datePaiement = new Date().toISOString().split('T')[0];
  const mois = datePaiement.slice(0, 7);
  console.log("→ Ajouter cotisation :", { adherentId, montant, datePaiement, mois });

  db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `).run(adherentId, montant, datePaiement, mois);
}







// Supprimer une cotisation
function supprimerCotisation(id) {
  db.prepare(`DELETE FROM cotisations WHERE id = ?`).run(id);
}

// Modifier une cotisation
function modifierCotisation(cotisation) {
  db.prepare(`
    UPDATE cotisations SET montant = ?, date_paiement = ?
    WHERE id = ?
  `).run(cotisation.montant, cotisation.date_paiement, cotisation.id);
}

module.exports = {
  getCotisations,
  ajouterCotisation,
  supprimerCotisation,
  modifierCotisation,
  verifierCotisationAdherent  
};
