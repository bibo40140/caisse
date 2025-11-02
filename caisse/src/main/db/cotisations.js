// src/main/db/cotisations.js
const db = require('./db');

/**
 * Liste des cotisations avec jointure adhérent (pour les écrans d’historique)
 */
function getCotisations() {
  return db.prepare(`
    SELECT c.*, a.nom, a.prenom
    FROM cotisations c
    LEFT JOIN adherents a ON c.adherent_id = a.id
    ORDER BY c.date_paiement DESC, c.id DESC
  `).all();
}

/**
 * Récupère la dernière cotisation d’un adhérent.
 * Schéma attendu: cotisations(id, adherent_id, montant, date_paiement, mois)
 * - date_paiement: 'YYYY-MM-DD'
 * - mois: 'YYYY-MM' (optionnel mais utile)
 */
function getDerniereCotisation(adherentId) {
  return db.prepare(`
    SELECT id, adherent_id, montant, date_paiement AS date, mois
    FROM cotisations
    WHERE adherent_id = ?
    ORDER BY date_paiement DESC, id DESC
    LIMIT 1
  `).get(Number(adherentId)) || null;
}

/**
 * Ton checker historique (booléen) — on le conserve pour compat
 * Règle: une cotisation payée dans le mois courant => true
 */
function verifierCotisationAdherent(adherentId) {
  const moisActuel = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  // On autorise soit via la colonne 'mois', soit via strftime sur date_paiement
  const r = db.prepare(`
    SELECT COUNT(*) AS n
    FROM cotisations
    WHERE adherent_id = ?
      AND (
        (mois IS NOT NULL AND mois = ?)
        OR (strftime('%Y-%m', date_paiement) = ?)
      )
  `).get(Number(adherentId), moisActuel, moisActuel);
  return Number(r?.n || 0) > 0;
}

/**
 * Nouveau: vérifie et renvoie un OBJET détaillé pour l’UI.
 * - actif: true si une cotisation existe pour le mois courant (avec option de période de grâce en jours)
 * - status: 'valide' | 'expiree' | 'absente'
 * - expire_le: fin du mois courant (ou fin du mois de la dernière cotisation) au format ISO
 * - derniere_cotisation: la dernière ligne utile
 *
 * Remarque: ton modèle étant “par mois”, on définit l’expiration au dernier jour du mois payé.
 */
function verifierCotisation(adherentId, opts = {}) {
  const graceDays = Number(opts.graceDays || 0);

  const last = getDerniereCotisation(adherentId);
  if (!last) {
    return { actif: false, status: 'absente', expire_le: null, derniere_cotisation: null };
  }

  // Détermine le mois payé de la dernière cotisation: priorité à colonne 'mois', sinon dérivé de la date
  const moisStr = (last.mois && /^\d{4}-\d{2}$/.test(last.mois))
    ? last.mois
    : String(last.date || '').slice(0, 7); // 'YYYY-MM'

  if (!/^\d{4}-\d{2}$/.test(moisStr)) {
    // Données incomplètes → on considère non valide mais on renvoie la ligne pour debug UI
    return { actif: false, status: 'absente', expire_le: null, derniere_cotisation: last };
  }

  // Fin du mois de la cotisation
  const [y, m] = moisStr.split('-').map(Number);
  // JS: date = 1er du mois suivant, puis -1 jour
  const end = new Date(Date.UTC(y, m, 0)); // m = mois suivant indexé 1..12 → JS traite le débordement
  // Période de grâce
  const endWithGrace = new Date(end.getTime() + graceDays * 86400000);

  // Maintenant
  const now = new Date();
  const actif = now <= endWithGrace;

  return {
    actif,
    status: actif ? 'valide' : 'expiree',
    expire_le: end.toISOString(),
    derniere_cotisation: last,
  };
}

/**
 * Ajouter une cotisation (on remplit aussi 'mois' = 'YYYY-MM' pour accélérer les requêtes)
 */
function ajouterCotisation(adherentId, montant) {
  const datePaiement = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const mois = datePaiement.slice(0, 7);                       // 'YYYY-MM'
  db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `).run(Number(adherentId), Number(montant), datePaiement, mois);
}

/**
 * Supprimer / Modifier — inchangés
 */
function supprimerCotisation(id) {
  db.prepare(`DELETE FROM cotisations WHERE id = ?`).run(Number(id));
}

function modifierCotisation(c) {
  db.prepare(`
    UPDATE cotisations
    SET montant = ?, date_paiement = ?
    WHERE id = ?
  `).run(Number(c.montant), String(c.date_paiement), Number(c.id));
}

module.exports = {
  // existants
  getCotisations,
  ajouterCotisation,
  supprimerCotisation,
  modifierCotisation,
  verifierCotisationAdherent,
  // nouveaux
  getDerniereCotisation,
  verifierCotisation,
};
