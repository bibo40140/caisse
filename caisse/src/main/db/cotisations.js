// src/main/db/cotisations.js
const db = require('./db');

/** timestamp local pour SQLite (string à injecter dans SQL) */
function nowLocal() {
  return `datetime('now','localtime')`;
}

/** util: savoir si une colonne existe déjà */
function hasColumn(table, col) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === col);
  } catch {
    return false;
  }
}

/** assure la table + migre les anciens schémas */
function ensureSchema() {
  // 1) table de base (au cas où elle n’existe pas)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS cotisations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      adherent_id   INTEGER NOT NULL,
      montant       REAL    NOT NULL DEFAULT 0,
      date_paiement TEXT    NOT NULL
      -- colonnes ajoutées/migrées plus bas
    )
  `).run();

  // 2) migrations "ajout de colonnes" si absentes
  if (!hasColumn('cotisations', 'note')) {
    db.prepare(`ALTER TABLE cotisations ADD COLUMN note TEXT`).run();
  }
  if (!hasColumn('cotisations', 'created_at')) {
    db.prepare(`ALTER TABLE cotisations ADD COLUMN created_at TEXT`).run();
    db.prepare(`UPDATE cotisations SET created_at = ${nowLocal()} WHERE created_at IS NULL`).run();
  }
  if (!hasColumn('cotisations', 'updated_at')) {
    db.prepare(`ALTER TABLE cotisations ADD COLUMN updated_at TEXT`).run();
    db.prepare(`
      UPDATE cotisations
         SET updated_at = COALESCE(updated_at, created_at, ${nowLocal()})
       WHERE updated_at IS NULL
    `).run();
  }

  // 3) compat: ancien schéma avec colonne 'date' au lieu de 'date_paiement'
  const hasDatePaiement = hasColumn('cotisations', 'date_paiement');
  const hasDate = hasColumn('cotisations', 'date');

  if (!hasDatePaiement && hasDate) {
    // on ajoute 'date_paiement' et on copie depuis 'date'
    db.prepare(`ALTER TABLE cotisations ADD COLUMN date_paiement TEXT`).run();
    db.prepare(`UPDATE cotisations SET date_paiement = date WHERE date_paiement IS NULL AND date IS NOT NULL`).run();
    // on laisse 'date' en place (SQLite ne renomme/supprime pas facilement les colonnes)
  }

  // 4) index utiles
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_cotisations_adherent_date
      ON cotisations(adherent_id, date_paiement DESC)
  `).run();
}
ensureSchema();

/** SELECTs */
function getCotisations() {
  return db.prepare(`
    SELECT id, adherent_id, montant, date_paiement, note, created_at, updated_at
    FROM cotisations
    ORDER BY date_paiement DESC, id DESC
  `).all();
}

function getCotisationsParAdherent(adherentId) {
  return db.prepare(`
    SELECT id, adherent_id, montant, date_paiement, note, created_at, updated_at
    FROM cotisations
    WHERE adherent_id = ?
    ORDER BY date_paiement DESC, id DESC
  `).all(Number(adherentId));
}

function getCotisationById(id) {
  return db.prepare(`
    SELECT id, adherent_id, montant, date_paiement, note, created_at, updated_at
    FROM cotisations
    WHERE id = ?
  `).get(Number(id));
}

/** INSERT */
function ajouterCotisation(adherentId, montant, date_paiement = null, note = null) {
  const stmt = db.prepare(`
    INSERT INTO cotisations (adherent_id, montant, date_paiement, note, created_at, updated_at)
    VALUES (?, ?, COALESCE(?, ${nowLocal()}), ?, ${nowLocal()}, ${nowLocal()})
  `);
  const id = stmt.run(
    Number(adherentId),
    Number(montant || 0),
    date_paiement || null,
    note || null
  ).lastInsertRowid;
  return getCotisationById(id);
}

/** UPDATE */
function modifierCotisation(c) {
  const id = Number(c?.id);
  if (!id) throw new Error('ID requis');
  const adherentId   = Number(c.adherent_id ?? c.adherentId);
  const montant      = Number(c.montant ?? 0);
  const datePaiement = c.date_paiement ?? c.datePaiement ?? null;
  const note         = c.note ?? null;

  db.prepare(`
    UPDATE cotisations
       SET adherent_id   = ?,
           montant       = ?,
           date_paiement = COALESCE(?, date_paiement),
           note          = ?,
           updated_at    = ${nowLocal()}
     WHERE id = ?
  `).run(adherentId, montant, datePaiement, note, id);

  return getCotisationById(id);
}

/** DELETE */
function supprimerCotisation(id) {
  db.prepare(`DELETE FROM cotisations WHERE id = ?`).run(Number(id));
  return { ok: true };
}

/**
 * Vérifie si la cotisation d'un adhérent est "à jour" (<= 365 jours).
 * Retour: { ok:true, a_jour:boolean, derniere_cotisation:string|null, jours_depuis:number|null }
 */
function verifierCotisationAdherent(adherentId) {
  const row = db.prepare(`
    SELECT date_paiement
      FROM cotisations
     WHERE adherent_id = ?
     ORDER BY date_paiement DESC
     LIMIT 1
  `).get(Number(adherentId));

  if (!row) {
    return { ok: true, a_jour: false, derniere_cotisation: null, jours_depuis: null };
  }

  const last = row.date_paiement; // ISO 'YYYY-MM-DD' recommandé
  const info = db.prepare(`
    SELECT CAST((julianday('now','localtime') - julianday(?)) AS INT) AS days
  `).get(last);
  const diff = info ? Number(info.days) : null;

  const a_jour = diff != null && diff <= 365;
  return { ok: true, a_jour, derniere_cotisation: last, jours_depuis: diff };
}

module.exports = {
  getCotisations,
  getCotisationsParAdherent,
  ajouterCotisation,
  modifierCotisation,
  supprimerCotisation,
  verifierCotisationAdherent,
};
