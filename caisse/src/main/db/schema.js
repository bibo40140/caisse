// src/main/db/schema.js
// Schéma LOCAL unique et canonique (SQLite)
// - Active les FK
// - Crée toutes les tables et index nécessaires à l’app (caisse + inventaire v2.x)
// - Ne dépend PAS du backend (Neon). Les colonnes "remote_uuid" servent de pont avec les UUID distants.

function ensureLocalSchema(db) {
  // 🔥 MIGRATION: Supprimer la FK sur receptions.fournisseur_id si elle existe
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='receptions'").get();
    if (schema && schema.sql && schema.sql.includes('FOREIGN KEY (fournisseur_id)')) {
      console.log('[schema] Migration: suppression FK sur receptions.fournisseur_id...');
      
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE IF NOT EXISTS receptions_backup AS SELECT * FROM receptions;
        CREATE TABLE IF NOT EXISTS lignes_reception_backup AS SELECT * FROM lignes_reception;
        DROP TABLE IF EXISTS lignes_reception;
        DROP TABLE IF EXISTS receptions;
        
        CREATE TABLE receptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fournisseur_id INTEGER,
          date TEXT DEFAULT (datetime('now','localtime')),
          reference TEXT,
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          remote_uuid TEXT UNIQUE
        );
        
        CREATE TABLE lignes_reception (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reception_id INTEGER NOT NULL,
          produit_id INTEGER NOT NULL,
          quantite REAL NOT NULL,
          prix_unitaire REAL,
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          remote_uuid TEXT UNIQUE,
          FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
          FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
        );
        
        INSERT INTO receptions SELECT * FROM receptions_backup;
        INSERT INTO lignes_reception SELECT * FROM lignes_reception_backup;
        DROP TABLE receptions_backup;
        DROP TABLE lignes_reception_backup;
        COMMIT;
      `);
      console.log('[schema] Migration terminée avec succès');
    }
  } catch (e) {
    console.warn('[schema] Migration receptions FK:', e?.message || e);
  }

  // Toujours activer les FK en SQLite
  db.exec(`PRAGMA foreign_keys = ON;`);

  // --- META (version simple: tu peux incrémenter si un jour tu veux des migrations locales)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      schema_version INTEGER NOT NULL
    );
  `);
  try {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM app_meta`).get();
    if (!r || !r.n) {
      db.prepare(`INSERT INTO app_meta(schema_version) VALUES (1)`).run();
    }
  } catch {}

  // --- PARAMÈTRES LOCAUX (clé/valeur) — pour ce poste / ce fichier SQLite
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      key        TEXT PRIMARY KEY,
      value_json TEXT,
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_settings_key ON tenant_settings(key);`);

  // --- UNITÉS
  db.exec(`
    CREATE TABLE IF NOT EXISTS unites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nom         TEXT UNIQUE NOT NULL,
      remote_uuid TEXT UNIQUE    -- UUID de la table unites côté Neon
    );
  `);

  // --- FAMILLES
  db.exec(`
    CREATE TABLE IF NOT EXISTS familles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nom         TEXT UNIQUE NOT NULL,
      remote_uuid TEXT UNIQUE    -- UUID de la table familles côté Neon
    );
  `);

  // --- CATÉGORIES
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nom         TEXT NOT NULL,
      famille_id  INTEGER,
      remote_uuid TEXT UNIQUE,   -- UUID de la table categories côté Neon
      UNIQUE(nom, famille_id),
      FOREIGN KEY (famille_id) REFERENCES familles(id) ON DELETE SET NULL
    );
  `);

  // --- ADHÉRENTS
  db.exec(`
    CREATE TABLE IF NOT EXISTS adherents (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      nom                  TEXT NOT NULL,
      prenom               TEXT NOT NULL,
      email1               TEXT,
      email2               TEXT,
      telephone1           TEXT,
      telephone2           TEXT,
      adresse              TEXT,
      code_postal          TEXT,
      ville                TEXT,
      nb_personnes_foyer   INTEGER,
      tranche_age          TEXT,
      statut               TEXT NOT NULL DEFAULT 'actif',
      droit_entree         REAL DEFAULT 0,
      date_inscription     TEXT,
      archive              INTEGER DEFAULT 0,
      date_archivage       TEXT,
      date_reactivation    TEXT,
      remote_uuid          TEXT UNIQUE    -- UUID de l'adherent côté Neon
    );
  `);

  // --- MODES DE PAIEMENT
  db.exec(`
    CREATE TABLE IF NOT EXISTS modes_paiement (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nom          TEXT UNIQUE NOT NULL,
      taux_percent REAL DEFAULT 0,
      frais_fixe   REAL DEFAULT 0,
      actif        INTEGER DEFAULT 1,
      remote_uuid  TEXT UNIQUE   -- UUID du mode de paiement côté Neon
    );
  `);

  // --- FOURNISSEURS
  db.exec(`
    CREATE TABLE IF NOT EXISTS fournisseurs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nom          TEXT NOT NULL,
      contact      TEXT,
      email        TEXT,
      telephone    TEXT,
      adresse      TEXT,
      code_postal  TEXT,
      ville        TEXT,
      categorie_id INTEGER,
      referent_id  INTEGER,
      label        TEXT,
      remote_uuid  TEXT UNIQUE,   -- UUID du fournisseur côté Neon
      FOREIGN KEY (categorie_id) REFERENCES categories(id),
      FOREIGN KEY (referent_id)  REFERENCES adherents(id)
    );
  `);

  // --- PRODUITS (remote_uuid déjà utilisé pour le mapping avec Neon)
  db.exec(`
    CREATE TABLE IF NOT EXISTS produits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nom            TEXT NOT NULL,
      reference      TEXT UNIQUE NOT NULL,
      prix           REAL NOT NULL,
      stock          REAL NOT NULL DEFAULT 0,              -- REAL pour gérer kg/L si besoin
      code_barre     TEXT,
      unite_id       INTEGER,
      fournisseur_id INTEGER,
      categorie_id   INTEGER,
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      remote_uuid    TEXT,                                 -- mapping vers ID distant (Neon, UUID)
      FOREIGN KEY (unite_id)       REFERENCES unites(id),
      FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id),
      FOREIGN KEY (categorie_id)   REFERENCES categories(id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_produits_barcode     ON produits(code_barre);
    CREATE INDEX IF NOT EXISTS idx_produits_remote_uuid ON produits(remote_uuid);
  `);

  // --- Soft patch: ajouter colonne 'deleted' si elle n'existe pas
  try {
    const cols = db.prepare(`PRAGMA table_info(produits)`).all();
    const hasDeleted = cols.some(c => c.name === 'deleted');
    if (!hasDeleted) {
      db.exec(`ALTER TABLE produits ADD COLUMN deleted INTEGER DEFAULT 0;`);
      console.log('[schema] Colonne "deleted" ajoutée à produits');
    }
  } catch (e) {
    console.error('[schema] Erreur ajout colonne deleted:', e?.message || e);
  }

  // --- VENTES (header de vente)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ventes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      total            REAL,
      adherent_id      INTEGER,
      date_vente       TEXT DEFAULT (datetime('now','localtime')),
      mode_paiement_id INTEGER,
      frais_paiement   REAL DEFAULT 0,
      cotisation       REAL DEFAULT 0,
      sale_type        TEXT NOT NULL DEFAULT 'adherent',   -- 'adherent' | 'exterieur' | 'prospect'
      client_email     TEXT,
      updated_at       TEXT DEFAULT (datetime('now','localtime')),
      remote_uuid      TEXT UNIQUE,                        -- UUID de la vente côté Neon
      FOREIGN KEY (adherent_id)      REFERENCES adherents(id),
      FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date_vente);`);

  // --- LIGNES DE VENTE
  db.exec(`
    CREATE TABLE IF NOT EXISTS lignes_vente (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      vente_id       INTEGER NOT NULL,
      produit_id     INTEGER NOT NULL,
      quantite       REAL NOT NULL,
      prix           REAL NOT NULL,
      prix_unitaire  REAL,
      remise_percent REAL DEFAULT 0,
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      remote_uuid    TEXT UNIQUE,                          -- UUID de la ligne côté Neon (optionnel, mais prêt)
      FOREIGN KEY (vente_id)   REFERENCES ventes(id)   ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente ON lignes_vente(vente_id);`);

  // --- COTISATIONS (local uniquement pour l'instant)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cotisations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      adherent_id   INTEGER NOT NULL,
      mois          TEXT NOT NULL,
      montant       REAL NOT NULL,
      date_paiement TEXT DEFAULT (date('now')),
      FOREIGN KEY (adherent_id) REFERENCES adherents(id)
    );
  `);

  // --- RÉCEPTIONS
  // ⚠️ Pas de FK sur fournisseur_id car il peut être NULL (module désactivé)
  db.exec(`
    CREATE TABLE IF NOT EXISTS receptions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      fournisseur_id INTEGER,
      date           TEXT DEFAULT (datetime('now','localtime')),
      reference      TEXT,
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      remote_uuid    TEXT UNIQUE                          -- UUID de la réception côté Neon
    );
  `);

  // --- LIGNES DE RÉCEPTION
  db.exec(`
    CREATE TABLE IF NOT EXISTS lignes_reception (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      reception_id   INTEGER NOT NULL,
      produit_id     INTEGER NOT NULL,
      quantite       REAL NOT NULL,
      prix_unitaire  REAL,
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      remote_uuid    TEXT UNIQUE,                          -- UUID de la ligne côté Neon (optionnel)
      FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id)   REFERENCES produits(id)   ON DELETE CASCADE
    );
  `);

  // --- PANIER / CAISSE (pour l’UI de caisse, local only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS carts (
      id               TEXT PRIMARY KEY,
      name             TEXT,
      sale_type        TEXT NOT NULL DEFAULT 'adherent',
      adherent_id      INTEGER,
      prospect_id      INTEGER,
      client_email     TEXT,
      mode_paiement_id INTEGER,
      meta             TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (adherent_id)      REFERENCES adherents(id),
      FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id         TEXT NOT NULL,
      produit_id      INTEGER,
      nom             TEXT,
      fournisseur_nom TEXT,
      unite           TEXT,
      prix            REAL,
      quantite        REAL,
      remise_percent  REAL,
      type            TEXT,          -- 'produit' | 'cotisation' | 'acompte'
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      FOREIGN KEY (cart_id)    REFERENCES carts(id)     ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id)  ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
  `);

  // --- PROSPECTS (si module prospects est utilisé)
  db.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nom           TEXT,
      prenom        TEXT,
      email         TEXT,
      telephone     TEXT,
      adresse       TEXT,
      code_postal   TEXT,
      ville         TEXT,
      note          TEXT,
      status        TEXT DEFAULT 'actif',
      date_creation TEXT DEFAULT (datetime('now','localtime')),
      adherent_id   INTEGER,
      FOREIGN KEY (adherent_id) REFERENCES adherents(id) ON DELETE SET NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS prospects_invitations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id  INTEGER NOT NULL,
      subject      TEXT,
      body_html    TEXT,
      date_reunion TEXT,
      sent_at      TEXT DEFAULT (datetime('now','localtime')),
      sent_by      TEXT,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_prospects_email   ON prospects(email);
    CREATE INDEX IF NOT EXISTS idx_prospects_status  ON prospects(status);
    CREATE INDEX IF NOT EXISTS idx_invits_prospect   ON prospects_invitations(prospect_id);
  `);

  // --- JOURNAL D’OPÉRATIONS (sync & mode offline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_queue (
      id           TEXT PRIMARY KEY, -- UUID client
      device_id    TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      op_type      TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      payload_json TEXT NOT NULL,
      sent_at      TEXT,
      ack          INTEGER NOT NULL DEFAULT 0,
      retry_count  INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      failed_at    TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ops_queue_created ON ops_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_ops_queue_ack     ON ops_queue(ack);
    CREATE INDEX IF NOT EXISTS idx_ops_queue_retry   ON ops_queue(retry_count);
  `);

  // --- INVENTAIRE (local cache + compat UI)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      status     TEXT NOT NULL DEFAULT 'open',
      started_at TEXT DEFAULT (datetime('now','localtime')),
      ended_at   TEXT,
      remote_uuid TEXT UNIQUE   -- UUID de la session d'inventaire côté Neon (optionnel, pour plus tard)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      produit_id   INTEGER NOT NULL,
      qty          REAL NOT NULL,
      user         TEXT,
      device_id    TEXT,
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (produit_id) REFERENCES produits(id)          ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inv_counts_session ON inventory_counts(session_id);
    CREATE INDEX IF NOT EXISTS idx_inv_counts_prod    ON inventory_counts(produit_id);
  `);

  // --- STOCK MOVEMENTS (local, pour historiser les mouvements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id    INTEGER NOT NULL,
      source        TEXT NOT NULL, -- 'vente' | 'reception' | 'inventory' | 'adjust'
      source_id     TEXT,
      delta         REAL NOT NULL,
      meta          TEXT,
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sm_produit ON stock_movements(produit_id);
    CREATE INDEX IF NOT EXISTS idx_sm_created ON stock_movements(created_at);
  `);

  // --- PATCHS DOUX (ajout de remote_uuid si base existante)
  try { db.prepare("ALTER TABLE produits ADD COLUMN remote_uuid TEXT").run(); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_produits_remote_uuid ON produits(remote_uuid);"); } catch {}

  try { db.prepare("ALTER TABLE unites ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE familles ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE categories ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE adherents ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE fournisseurs ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE modes_paiement ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}

  try { db.prepare("ALTER TABLE ventes ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE lignes_vente ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE receptions ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE lignes_reception ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  try { db.prepare("ALTER TABLE inventory_sessions ADD COLUMN remote_uuid TEXT UNIQUE").run(); } catch {}
  // --- PATCH: add per-op metadata to ops_queue if missing
  try { db.prepare("ALTER TABLE ops_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE ops_queue ADD COLUMN last_error TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE ops_queue ADD COLUMN failed_at TEXT").run(); } catch {}
}

module.exports = { ensureLocalSchema };
