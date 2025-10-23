// src/main/db/cotisations.js
const db = require('./db');

/* ───────── Helpers date ───────── */
function toISO(d) { try { return new Date(d).toISOString().slice(0, 10); } catch { return null; } }
function todayISO() { return toISO(new Date()); }
function firstDayOfCurrentMonthISO() { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return toISO(d); }

/* ───────── Schéma actuel ───────── */
function tableHasColumn(table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r?.name === col); }
  catch { return false; }
}
const HAS_MOIS  = tableHasColumn('cotisations', 'mois');
const HAS_ANNEE = tableHasColumn('cotisations', 'annee');

/* ───────── Listes pour filtres UI ───────── */
function listMoisDistincts() {
  const moisExpr = HAS_MOIS ? 'c.mois' : `substr(c.date_paiement, 1, 7)`;
  return db.prepare(`SELECT DISTINCT ${moisExpr} AS mois FROM cotisations c WHERE ${moisExpr} IS NOT NULL ORDER BY mois DESC`).all()
           .map(r => r.mois)
           .filter(Boolean);
}

function listAdherentsForFilter() {
  // On propose tous les adhérents existants (plus convivial que “distinct cotisants”)
  return db.prepare(`SELECT id, nom, prenom FROM adherents ORDER BY nom, prenom, id`).all();
}

/* ───────── CRUD / Lecture ───────── */
function getCotisations({ mois = null, adherentId = null } = {}) {
  const moisExpr = HAS_MOIS ? 'c.mois' : `substr(c.date_paiement, 1, 7)`;
  const where = [];
  const args = [];

  if (mois) { where.push(`${moisExpr} = ?`); args.push(String(mois).slice(0,7)); }
  if (adherentId) { where.push(`c.adherent_id = ?`); args.push(Number(adherentId)); }

  const sql = `
    SELECT
      c.id,
      c.adherent_id,
      c.montant,
      c.date_paiement,
      ${moisExpr} AS mois,
      a.nom   AS adherent_nom,
      a.prenom AS adherent_prenom
    FROM cotisations c
    LEFT JOIN adherents a ON a.id = c.adherent_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.date_paiement DESC, c.id DESC
  `;
  return db.prepare(sql).all(...args);
}

function getCotisationsParAdherent(adherentId) {
  const moisExpr = HAS_MOIS ? 'c.mois' : `substr(c.date_paiement, 1, 7)`;
  return db.prepare(`
    SELECT
      c.id, c.adherent_id, c.montant, c.date_paiement,
      ${moisExpr} AS mois,
      a.nom AS adherent_nom, a.prenom AS adherent_prenom
    FROM cotisations c
    LEFT JOIN adherents a ON a.id = c.adherent_id
    WHERE c.adherent_id = ?
    ORDER BY c.date_paiement DESC, c.id DESC
  `).all(Number(adherentId));
}

function ajouterCotisation(adherentId, montant, date_paiement = null) {
  const datePay = date_paiement ? String(date_paiement).slice(0, 10) : todayISO();
  const moisStr = datePay.slice(0, 7);         // YYYY-MM
  const anneeNb = Number(datePay.slice(0, 4)); // YYYY

  const cols = ['adherent_id', 'montant', 'date_paiement'];
  const vals = [Number(adherentId), Number(montant || 0), datePay];

  if (HAS_MOIS)  { cols.push('mois');  vals.push(moisStr); }
  if (HAS_ANNEE) { cols.push('annee'); vals.push(anneeNb); }

  const sql = `INSERT INTO cotisations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const r = db.prepare(sql).run(...vals);
  return { ok: true, id: Number(r.lastInsertRowid) };
}

function modifierCotisation(c) {
  const id = Number(c?.id);
  if (!Number.isFinite(id)) throw new Error('id invalide');

  const adherentId = Number(c.adherent_id);
  const montant    = Number(c.montant ?? 0);
  const datePay    = c.date_paiement ? String(c.date_paiement).slice(0, 10) : todayISO();
  const moisStr    = datePay.slice(0, 7);
  const anneeNb    = Number(datePay.slice(0, 4));

  const sets = ['adherent_id = ?', 'montant = ?', 'date_paiement = ?'];
  const vals = [adherentId, montant, datePay];

  if (HAS_MOIS)  { sets.push('mois = ?');  vals.push(moisStr); }
  if (HAS_ANNEE) { sets.push('annee = ?'); vals.push(anneeNb); }

  const sql = `UPDATE cotisations SET ${sets.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...vals, id);
  return { ok: true };
}

function supprimerCotisation(id) {
  db.prepare(`DELETE FROM cotisations WHERE id = ?`).run(Number(id));
  return { ok: true };
}

/* ───────── Vérification mensuelle ───────── */
function firstDayCurrentMonth() { return firstDayOfCurrentMonthISO(); }

function verifierCotisationAdherent(adherentId) {
  const last = db.prepare(`
    SELECT date_paiement
    FROM cotisations
    WHERE adherent_id = ?
    ORDER BY date_paiement DESC, id DESC
    LIMIT 1
  `).get(Number(adherentId));

  const derniere = last?.date_paiement ? String(last.date_paiement).slice(0,10) : null;

  const firstOfMonth = firstDayOfCurrentMonthISO();
  const rowInMonth = db.prepare(`
    SELECT 1
    FROM cotisations
    WHERE adherent_id = ?
      AND date_paiement >= ?
    LIMIT 1
  `).get(Number(adherentId), firstOfMonth);

  let ageJours = null;
  if (derniere) {
    const now = new Date();
    const lastDate = new Date(derniere);
    ageJours = Math.floor((now - lastDate) / (1000*60*60*24));
  }

  return {
    ok: true,
    a_jour: !!rowInMonth,
    derniere_cotisation: derniere,
    age_jours: ageJours,
    jours_depuis: ageJours,
    mois_courant: firstOfMonth.slice(0,7) // "YYYY-MM"
  };
}

module.exports = {
  // listes pour la page
  listMoisDistincts,
  listAdherentsForFilter,

  // CRUD/lecture
  getCotisations,
  getCotisationsParAdherent,
  ajouterCotisation,
  modifierCotisation,
  supprimerCotisation,

  // contrôle
  verifierCotisationAdherent,
};
