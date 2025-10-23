// src/main/db/schema.js
// Source de vérité : crée/normalise TOUTES les tables locales (idempotent)
const db = require('./db');

// petite aide pour ALTER TABLE idempotents
function safe(sql) { try { db.prepare(sql).run(); } catch (_) {} }

function ensureSchema() {
  db.pragma('foreign_keys = ON');

  // === Référentiels ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS unites(
      id   INTEGER PRIMARY KEY,
      nom  TEXT NOT NULL UNIQUE
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS familles(
      id   INTEGER PRIMARY KEY,
      nom  TEXT NOT NULL UNIQUE
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS categories(
      id          INTEGER PRIMARY KEY,
      nom         TEXT NOT NULL,
      famille_id  INTEGER,
      UNIQUE(nom),
      FOREIGN KEY(famille_id) REFERENCES familles(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS fournisseurs(
      id           INTEGER PRIMARY KEY,
      nom          TEXT NOT NULL,
      contact      TEXT,
      email        TEXT,
      telephone    TEXT,
      adresse      TEXT,
      code_postal  TEXT,
      ville        TEXT,
      categorie_id INTEGER,
      referent_id  INTEGER,
      label        TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS adherents(
      id                    INTEGER PRIMARY KEY,
      nom                   TEXT,
      prenom                TEXT,
      email1                TEXT,
      email2                TEXT,
      telephone1            TEXT,
      telephone2            TEXT,
      adresse               TEXT,
      code_postal           TEXT,
      ville                 TEXT,
      nb_personnes_foyer    INTEGER,
      tranche_age           TEXT,
      droit_entree          REAL,
      date_inscription      TEXT,
      archive               INTEGER DEFAULT 0,
      date_archivage        TEXT,
      date_reactivation     TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS produits(
      id             INTEGER PRIMARY KEY,
      nom            TEXT NOT NULL,
      reference      TEXT,
      prix           REAL DEFAULT 0,
      stock          REAL DEFAULT 0,           -- stock local (sera recalé par mouvements)
      code_barre     TEXT,
      unite_id       INTEGER,
      fournisseur_id INTEGER,
      categorie_id   INTEGER,
      updated_at     TEXT
    )
  `).run();
  safe(`CREATE INDEX IF NOT EXISTS idx_produits_cat ON produits(categorie_id)`);
  safe(`CREATE INDEX IF NOT EXISTS idx_produits_fourn ON produits(fournisseur_id)`);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS modes_paiement(
      id            INTEGER PRIMARY KEY,
      nom           TEXT UNIQUE NOT NULL,
      taux_percent  REAL DEFAULT 0,
      frais_fixe    REAL DEFAULT 0,
      actif         INTEGER DEFAULT 1
    )
  `).run();

  // === Ventes ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ventes(
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      total            REAL,
      adherent_id      INTEGER,
      mode_paiement_id INTEGER,
      sale_type        TEXT,
      client_email     TEXT,
      frais_paiement   REAL,
      cotisation       REAL
    )
  `).run();
  // timestamps requis par tes handlers
  safe(`ALTER TABLE ventes ADD COLUMN created_at TEXT`);
  safe(`ALTER TABLE ventes ADD COLUMN updated_at TEXT`);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS lignes_vente(
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      vente_id        INTEGER NOT NULL,
      produit_id      INTEGER NOT NULL,
      quantite        REAL NOT NULL,
      prix            REAL NOT NULL,
      prix_unitaire   REAL,
      remise_percent  REAL DEFAULT 0,
      FOREIGN KEY(vente_id) REFERENCES ventes(id),
      FOREIGN KEY(produit_id) REFERENCES produits(id)
    )
  `).run();
  safe(`ALTER TABLE lignes_vente ADD COLUMN created_at TEXT`);
  safe(`ALTER TABLE lignes_vente ADD COLUMN updated_at TEXT`);
  safe(`CREATE INDEX IF NOT EXISTS idx_lv_vente ON lignes_vente(vente_id)`);
  safe(`CREATE INDEX IF NOT EXISTS idx_lv_prod  ON lignes_vente(produit_id)`);

  // === Réceptions (aligné avec src/main/db/receptions.js) ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS receptions(
      id             INTEGER PRIMARY KEY,
      fournisseur_id INTEGER NOT NULL,
      date           TEXT DEFAULT (datetime('now','localtime')),
      reference      TEXT,
      updated_at     TEXT DEFAULT (datetime('now','localtime'))
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS lignes_reception(
      id            INTEGER PRIMARY KEY,           -- parfois inséré explicitement
      reception_id  INTEGER NOT NULL,
      produit_id    INTEGER NOT NULL,
      quantite      REAL NOT NULL,
      prix_unitaire REAL,
      updated_at    TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(reception_id) REFERENCES receptions(id),
      FOREIGN KEY(produit_id)  REFERENCES produits(id)
    )
  `).run();
  safe(`CREATE INDEX IF NOT EXISTS idx_lr_rec  ON lignes_reception(reception_id)`);
  safe(`CREATE INDEX IF NOT EXISTS idx_lr_prod ON lignes_reception(produit_id)`);

  // === Mouvements de stock (locaux) ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_movements(
      id         TEXT PRIMARY KEY,                 -- uuid (généré dans handlers)
      produit_id INTEGER NOT NULL,
      delta      REAL NOT NULL,                    -- + réception, - vente, etc.
      reason     TEXT,                             -- 'reception' | 'sale' | ...
      ref_type   TEXT,                             -- 'reception' | 'sale_line' | ...
      ref_id     TEXT,
      note       TEXT,
      device_id  TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `).run();
  safe(`CREATE INDEX IF NOT EXISTS idx_sm_prod ON stock_movements(produit_id)`);

  // === Queue d'opérations (push vers Neon) ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ops_queue(
      id           TEXT PRIMARY KEY,               -- uuid
      device_id    TEXT NOT NULL,
      op_type      TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      payload_json TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      sent_at      TEXT,
      ack          INTEGER DEFAULT 0               -- 0 = en attente, 1 = acké
    )
  `).run();
  safe(`CREATE INDEX IF NOT EXISTS idx_ops_ack ON ops_queue(ack, created_at)`);

  // === Inventaire (côté local si tu enregistres) — optionnel mais safe ===
  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_sessions(
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      status     TEXT DEFAULT 'open',
      user       TEXT,
      notes      TEXT,
      started_at TEXT DEFAULT (datetime('now','localtime')),
      ended_at   TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_counts(
      session_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      device_id  TEXT NOT NULL,
      user       TEXT,
      qty        REAL NOT NULL,
      updated_at TEXT,
      PRIMARY KEY(session_id, product_id, device_id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_snapshot(
      session_id  INTEGER NOT NULL,
      product_id  INTEGER NOT NULL,
      stock_start REAL NOT NULL,
      unit_cost   REAL,
      PRIMARY KEY(session_id, product_id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_adjust(
      session_id   INTEGER NOT NULL,
      product_id   INTEGER NOT NULL,
      stock_start  REAL NOT NULL,
      counted_total REAL NOT NULL,
      delta        REAL NOT NULL,
      unit_cost    REAL,
      delta_value  REAL
    )
  `).run();

  // Backfill minimal des timestamps si manquants (ne casse rien)
  safe(`UPDATE ventes SET created_at = COALESCE(created_at, datetime('now','localtime'))`);
  safe(`UPDATE lignes_vente SET created_at = COALESCE(created_at, datetime('now','localtime'))`);
}

module.exports = { ensureSchema };
