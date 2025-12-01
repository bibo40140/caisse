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
      console.log('[schema] ⚠️  Cette migration nécessite de supprimer et recréer les tables.');
      console.log('[schema] Les données existantes seront préservées si possible.');
      
      db.exec('PRAGMA foreign_keys = OFF;');
      
      try {
        db.exec(`
          BEGIN TRANSACTION;
          
          -- Sauvegarder les données
          CREATE TEMP TABLE receptions_backup AS 
          SELECT id, fournisseur_id, date, reference, 
                 COALESCE(updated_at, datetime('now','localtime')) as updated_at 
          FROM receptions;
          
          CREATE TEMP TABLE lignes_reception_backup AS 
          SELECT id, reception_id, produit_id, quantite, prix_unitaire,
                 COALESCE(updated_at, datetime('now','localtime')) as updated_at
          FROM lignes_reception;
          
          -- Supprimer les anciennes tables
          DROP TABLE lignes_reception;
          DROP TABLE receptions;
          
          -- Recréer sans FK sur fournisseur
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
          
          -- Restaurer les données
          INSERT INTO receptions (id, fournisseur_id, date, reference, updated_at)
          SELECT id, fournisseur_id, date, reference, updated_at FROM receptions_backup;
          
          INSERT INTO lignes_reception (id, reception_id, produit_id, quantite, prix_unitaire, updated_at)
          SELECT id, reception_id, produit_id, quantite, prix_unitaire, updated_at FROM lignes_reception_backup;
          
          COMMIT;
        `);
        console.log('[schema] Migration terminée avec succès');
      } catch (innerErr) {
        db.exec('ROLLBACK;');
        console.error('[schema] ❌ Migration échouée:', innerErr?.message);
        console.log('[schema] Les tables n\'ont pas été modifiées');
      }
    }
  } catch (e) {
    console.warn('[schema] Migration receptions FK (erreur externe):', e?.message || e);
  }

  // 🔥 MIGRATION 1: Supprimer la FK sur cart_items.produit_id si elle existe
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cart_items'").get();
    if (schema && schema.sql && schema.sql.includes('FOREIGN KEY (produit_id)')) {
      console.log('[schema] Migration 1: suppression FK sur cart_items.produit_id...');
      
      db.exec('PRAGMA foreign_keys = OFF;');
      
      try {
        db.exec(`
          BEGIN TRANSACTION;
          
          -- Sauvegarder les données existantes
          CREATE TEMP TABLE cart_items_backup AS SELECT * FROM cart_items;
          
          -- Supprimer l'ancienne table
          DROP TABLE cart_items;
          
          -- Recréer sans FK sur produit_id
          CREATE TABLE cart_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            cart_id         TEXT NOT NULL,
            produit_id      INTEGER,
            nom             TEXT,
            fournisseur_nom TEXT,
            unite           TEXT,
            prix            REAL,
            quantite        REAL,
            remise_percent  REAL,
            type            TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
          );
          
          -- Restaurer les données
          INSERT INTO cart_items SELECT * FROM cart_items_backup;
          
          -- Nettoyer
          DROP TABLE cart_items_backup;
          
          COMMIT;
        `);
        console.log('[schema] Migration 1 (cart_items) terminée avec succès');
      } catch (innerErr) {
        db.exec('ROLLBACK;');
        console.error('[schema] ❌ Migration 1 (cart_items) échouée:', innerErr?.message);
      }
      
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } catch (e) {
    console.warn('[schema] Migration 1 (cart_items) - erreur externe:', e?.message || e);
  }

  // 🔥 MIGRATION 2: Supprimer la FK sur carts.adherent_id si elle existe
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='carts'").get();
    if (schema && schema.sql && schema.sql.includes('FOREIGN KEY (adherent_id)')) {
      console.log('[schema] Migration 2: suppression FK sur carts.adherent_id...');
      
      db.exec('PRAGMA foreign_keys = OFF;');
      
      try {
        db.exec(`
          BEGIN TRANSACTION;
          
          -- Sauvegarder les données existantes
          CREATE TEMP TABLE carts_backup AS SELECT * FROM carts;
          
          -- Supprimer l'ancienne table avec items (cascade)
          DROP TABLE IF EXISTS cart_items;
          DROP TABLE carts;
          
          -- Recréer carts sans FK sur adherent_id
          CREATE TABLE carts (
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
            FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
          );
          
          -- Recréer cart_items
          CREATE TABLE cart_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            cart_id         TEXT NOT NULL,
            produit_id      INTEGER,
            nom             TEXT,
            fournisseur_nom TEXT,
            unite           TEXT,
            prix            REAL,
            quantite        REAL,
            remise_percent  REAL,
            type            TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
          );
          
          -- Restaurer les données carts
          INSERT INTO carts SELECT * FROM carts_backup;
          
          -- Nettoyer
          DROP TABLE carts_backup;
          
          COMMIT;
        `);
        console.log('[schema] Migration 2 (carts) terminée avec succès');
      } catch (innerErr) {
        db.exec('ROLLBACK;');
        console.error('[schema] ❌ Migration 2 (carts) échouée:', innerErr?.message);
      }
      
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } catch (e) {
    console.warn('[schema] Migration 2 (carts) - erreur externe:', e?.message || e);
  }

  // 🔥 MIGRATION 3: Supprimer la FK sur inventory_counts.produit_id si elle existe
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_counts'").get();
    if (schema && schema.sql && schema.sql.includes('FOREIGN KEY (produit_id)')) {
      console.log('[schema] Migration 3: suppression FK sur inventory_counts.produit_id...');
      
      db.exec('PRAGMA foreign_keys = OFF;');
      
      try {
        db.exec(`
          BEGIN TRANSACTION;
          
          -- Sauvegarder les données existantes
          CREATE TEMP TABLE inventory_counts_backup AS SELECT * FROM inventory_counts;
          
          -- Supprimer l'ancienne table
          DROP TABLE inventory_counts;
          
          -- Recréer sans FK sur produit_id
          CREATE TABLE inventory_counts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id   INTEGER NOT NULL,
            produit_id   INTEGER NOT NULL,
            qty          REAL NOT NULL,
            user         TEXT,
            device_id    TEXT,
            created_at   TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE
          );
          
          -- Restaurer les données
          INSERT INTO inventory_counts SELECT * FROM inventory_counts_backup;
          
          -- Nettoyer
          DROP TABLE inventory_counts_backup;
          
          COMMIT;
        `);
        console.log('[schema] Migration 3 (inventory_counts) terminée avec succès');
      } catch (innerErr) {
        db.exec('ROLLBACK;');
        console.error('[schema] ❌ Migration 3 (inventory_counts) échouée:', innerErr?.message);
      }
      
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } catch (e) {
    console.warn('[schema] Migration 3 (inventory_counts) - erreur externe:', e?.message || e);
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
      adherent_id      INTEGER,  -- Pas de FK: permet de mettre l'ID même si adhérent pas encore sync
      prospect_id      INTEGER,
      client_email     TEXT,
      mode_paiement_id INTEGER,
      meta             TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      status           TEXT NOT NULL DEFAULT 'open',
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
      FOREIGN KEY (cart_id)    REFERENCES carts(id)     ON DELETE CASCADE
      -- Pas de FK sur produit_id car on veut garder l'historique même si produit supprimé
      -- et pour éviter les problèmes de sync entre IDs locaux et UUIDs distants
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

  // --- SYNC STATE (pour pull incrémental optimisé)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      entity_type  TEXT PRIMARY KEY,  -- 'produits', 'ventes', 'receptions', 'stock_movements', etc.
      last_sync_at TEXT NOT NULL,      -- Timestamp du dernier pull réussi
      last_sync_ok INTEGER DEFAULT 1,  -- 1 si succès, 0 si erreur
      updated_at   TEXT DEFAULT (datetime('now','localtime'))
    );
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

  // --- INVENTORY SUMMARY (résumé local pour consultation offline)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_summary (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     INTEGER NOT NULL,
      produit_id     INTEGER NOT NULL,
      stock_start    REAL NOT NULL DEFAULT 0,
      counted_total  REAL NOT NULL DEFAULT 0,
      delta          REAL NOT NULL DEFAULT 0,
      unit_cost      REAL NOT NULL DEFAULT 0,
      delta_value    REAL NOT NULL DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
      UNIQUE (session_id, produit_id)
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inv_summary_session ON inventory_summary(session_id);
    CREATE INDEX IF NOT EXISTS idx_inv_summary_prod    ON inventory_summary(produit_id);
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
      remote_uuid   TEXT,           -- UUID du mouvement côté serveur
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
    );
  `);
  
  // Index optimisés pour les requêtes fréquentes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sm_produit ON stock_movements(produit_id);
    CREATE INDEX IF NOT EXISTS idx_sm_created ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_sm_remote_uuid ON stock_movements(remote_uuid);
    CREATE INDEX IF NOT EXISTS idx_sm_source ON stock_movements(source, source_id);
  `);
  
  // Index pour les produits (recherche rapide par code-barre, référence)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_produits_code_barre ON produits(code_barre) WHERE code_barre IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_produits_reference ON produits(reference) WHERE reference IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_produits_categorie ON produits(categorie_id);
    CREATE INDEX IF NOT EXISTS idx_produits_fournisseur ON produits(fournisseur_id);
  `);
  
  // Index pour les ventes et réceptions (tri chronologique)
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date DESC);
      CREATE INDEX IF NOT EXISTS idx_receptions_date ON receptions(date DESC);
    `);
  } catch (e) {
    console.warn('[schema] Erreur création index dates:', e?.message);
  }
  
  // Index updated_at (seulement si colonnes existent)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ventes_updated ON ventes(updated_at);`);
  } catch (e) {
    // Colonne updated_at n'existe peut-être pas encore
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_receptions_updated ON receptions(updated_at);`);
  } catch (e) {
    // Colonne updated_at n'existe peut-être pas encore
  }
  
  // Index pour les lignes (JOIN rapides)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente ON lignes_vente(vente_id);
    CREATE INDEX IF NOT EXISTS idx_lignes_vente_produit ON lignes_vente(produit_id);
    CREATE INDEX IF NOT EXISTS idx_lignes_reception_reception ON lignes_reception(reception_id);
    CREATE INDEX IF NOT EXISTS idx_lignes_reception_produit ON lignes_reception(produit_id);
  `);
  
  // Index pour ops_queue (sync rapide)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ops_ack ON ops_queue(ack, created_at);`);
  } catch (e) {
    console.warn('[schema] Erreur index ops_queue:', e?.message);
  }
  
  // Index remote_uuid seulement si colonne existe
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ops_remote_uuid ON ops_queue(remote_uuid) WHERE remote_uuid IS NOT NULL;`);
  } catch (e) {
    // Colonne remote_uuid n'existe peut-être pas encore
  }

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

  // 🔥 MIGRATION: Ajouter colonne remote_uuid à stock_movements si elle n'existe pas
  try {
    const cols = db.prepare("PRAGMA table_info(stock_movements)").all();
    const hasRemoteUuid = cols.some(c => c.name === 'remote_uuid');
    if (!hasRemoteUuid) {
      console.log('[schema] Migration: ajout colonne remote_uuid à stock_movements...');
      db.exec('ALTER TABLE stock_movements ADD COLUMN remote_uuid TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sm_remote_uuid ON stock_movements(remote_uuid)');
      console.log('[schema] Migration remote_uuid terminée');
    }
  } catch (e) {
    console.warn('[schema] Migration stock_movements remote_uuid:', e?.message || e);
  }

  // 🔥 MIGRATION: Ajouter colonne acompte à ventes si elle n'existe pas
  try {
    const cols = db.prepare("PRAGMA table_info(ventes)").all();
    const hasAcompte = cols.some(c => c.name === 'acompte');
    if (!hasAcompte) {
      console.log('[schema] Migration: ajout colonne acompte à ventes...');
      db.exec('ALTER TABLE ventes ADD COLUMN acompte REAL DEFAULT 0');
      console.log('[schema] Migration acompte terminée');
    }
  } catch (e) {
    console.warn('[schema] Migration ventes acompte:', e?.message || e);
  }
}

module.exports = { ensureLocalSchema };
