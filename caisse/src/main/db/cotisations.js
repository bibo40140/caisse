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
 * - date_paiement: 'YYYY-MM-DD' (tolère HH:MM:SS)
 * - mois: 'YYYY-MM' (optionnel mais recommandé)
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
 * Checker historique (booléen) conservé pour compat.
 * Règle: une cotisation payée dans le MOIS CIVIL courant => true
 */
function verifierCotisationAdherent(adherentId) {
  const moisActuel = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  // On autorise via la colonne 'mois' OU via strftime(date_paiement)
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
 * - actif: true si une cotisation couvre le MOIS CIVIL en cours
 *          (calcul: fin du mois payé + graceDays >= maintenant)
 * - status: 'valide' | 'expiree' | 'absente'
 * - expire_le: dernière date du mois payé (en ISO)
 * - derniere_cotisation: la dernière ligne utile
 *
 * NB: Si la colonne 'mois' n’est pas renseignée, on déduit depuis 'date_paiement'.
 */
function verifierCotisation(adherentId, opts = {}) {
  const graceDaysRaw = Number(opts.graceDays || 0);
  const graceDays = Number.isFinite(graceDaysRaw) && graceDaysRaw > 0 ? graceDaysRaw : 0;

  const last = getDerniereCotisation(adherentId);
  if (!last) {
    return { actif: false, status: 'absente', expire_le: null, derniere_cotisation: null };
  }

  // Détermine le mois payé au format 'YYYY-MM'
  const moisStr = (() => {
    if (last.mois && /^\d{4}-\d{2}$/.test(last.mois)) return last.mois;
    const d = (last.date || '').toString();
    // d peut être 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS'
    if (d.length >= 7 && /^\d{4}-\d{2}/.test(d)) return d.slice(0, 7);
    return null;
  })();

  if (!moisStr) {
    // Données incomplètes → non valide mais on renvoie la ligne pour debug UI
    return { actif: false, status: 'absente', expire_le: null, derniere_cotisation: last };
  }
  // Fin du mois de la cotisation (mois 0-based en JS)
  const [y, mNum] = moisStr.split('-').map(Number);
  const monthIdx = mNum - 1;                 // 0..11
  const finMois = new Date(Date.UTC(y, monthIdx + 1, 0)); // dernier jour du mois "moisStr"

  const finAvecGrace = new Date(finMois.getTime() + graceDays * 86400000);

  const now = new Date();
  const actif = now <= finAvecGrace;

  return {
    actif,
    status: actif ? 'valide' : 'expiree',
    expire_le: finMois.toISOString(),
    derniere_cotisation: last,
  };
}

/**
 * Ajouter une cotisation (renseigne aussi 'mois' = 'YYYY-MM')
 * Évite les doublons en vérifiant si une cotisation existe déjà ce mois
 */
function ajouterCotisation(adherentId, montant) {
  const adhId = Number(adherentId);
  const montantNum = Number(montant);
  if (!Number.isFinite(adhId) || adhId <= 0) return false;
  if (!Number.isFinite(montantNum) || montantNum <= 0) return false;

  const datePaiement = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const mois = datePaiement.slice(0, 7);                       // 'YYYY-MM'
  
  // Vérifier si une cotisation existe déjà pour ce mois
  const exists = db.prepare(`
    SELECT id FROM cotisations
    WHERE adherent_id = ? AND mois = ?
    LIMIT 1
  `).get(adhId, mois);

  if (exists) {
    console.warn('[ajouterCotisation] Une cotisation existe déjà pour adhérent', adhId, 'mois', mois);
    return false;
  }

  db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `).run(adhId, montantNum, datePaiement, mois);
  
  return true;
}

// Insère la cotisation issue d'une vente si elle n'existe pas déjà pour ce mois.
function ensureCotisationFromVente(adherentId, montant, datePaiement = null) {
  const adhId = Number(adherentId);
  const montantNum = Number(montant);
  if (!Number.isFinite(adhId) || adhId <= 0) return false;
  if (!Number.isFinite(montantNum) || montantNum <= 0) return false;

  const dateStr = (datePaiement || new Date().toISOString()).toString().slice(0, 10);
  const mois = dateStr.slice(0, 7);
  if (!mois) return false;

  const exists = db.prepare(`
    SELECT id FROM cotisations
    WHERE adherent_id = ? AND mois = ?
    LIMIT 1
  `).get(adhId, mois);

  if (exists) return false;

  db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, mois)
    VALUES (?, ?, ?, ?)
  `).run(adhId, montantNum, dateStr, mois);

  return true;
}

/**
 * Supprimer / Modifier
 */
function supprimerCotisation(id) {
  db.prepare(`DELETE FROM cotisations WHERE id = ?`).run(Number(id));
}

function modifierCotisation(c) {
  const montant = Number(c.montant);
  const date = String(c.date_paiement);
  db.prepare(`
    UPDATE cotisations
    SET montant = ?, date_paiement = ?
    WHERE id = ?
  `).run(montant, date, Number(c.id));
}

module.exports = {
  getCotisations,
  ajouterCotisation,
  supprimerCotisation,
  modifierCotisation,
  verifierCotisationAdherent, // compat booléenne
  getDerniereCotisation,
  verifierCotisation,         // logique riche pour l’UI
  ensureCotisationFromVente,
};
