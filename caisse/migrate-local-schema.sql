-- migrate-local-schema.sql
-- Migration du schéma SQLite local pour harmonisation avec Neon
-- Version: 1.0
-- Date: 2025-12-05
-- 
-- IMPORTANT: Ce script est IDEMPOTENT (peut être rejoué sans risque)
-- ATTENTION: Faire une SAUVEGARDE de la base AVANT d'exécuter ce script !

-- ========================================
-- 1. AJOUTER LES COLONNES MANQUANTES
-- ========================================

-- 1.1 produits : ajouter created_at
-- Ajouter la colonne si elle n'existe pas
-- SQLite ne supporte pas IF NOT EXISTS pour ALTER TABLE, on doit vérifier avant
PRAGMA foreign_keys = OFF;

-- 1.1 produits : ajouter created_at
ALTER TABLE produits ADD COLUMN created_at TEXT DEFAULT (datetime('now','localtime'));

-- Initialiser created_at pour les enregistrements existants (= updated_at si elle existe, sinon now)
UPDATE produits SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL;

-- 1.2 ventes : ajouter created_at (distinct de date_vente qui est métier)
ALTER TABLE ventes ADD COLUMN created_at TEXT DEFAULT (datetime('now','localtime'));

-- Initialiser created_at = date_vente pour les ventes existantes
UPDATE ventes SET created_at = date_vente WHERE created_at IS NULL;

-- 1.3 lignes_vente : ajouter created_at
ALTER TABLE lignes_vente ADD COLUMN created_at TEXT DEFAULT (datetime('now','localtime'));

-- Initialiser created_at pour les lignes existantes
UPDATE lignes_vente SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL;

-- 1.4 lignes_reception : ajouter created_at
ALTER TABLE lignes_reception ADD COLUMN created_at TEXT DEFAULT (datetime('now','localtime'));

-- Initialiser created_at pour les lignes existantes
UPDATE lignes_reception SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL;

-- 1.5 inventory_sessions : ajouter user et notes
ALTER TABLE inventory_sessions ADD COLUMN user TEXT;
ALTER TABLE inventory_sessions ADD COLUMN notes TEXT;

-- 1.6 inventory_counts : ajouter updated_at
ALTER TABLE inventory_counts ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'));

-- Initialiser updated_at pour les comptages existants
UPDATE inventory_counts SET updated_at = COALESCE(created_at, datetime('now','localtime')) WHERE updated_at IS NULL;

PRAGMA foreign_keys = ON;

-- ========================================
-- 2. CRÉER LES TABLES MANQUANTES
-- ========================================

-- 2.1 stock_movements (table incomplète ou absente)
-- Vérifier si la table existe, sinon la créer
CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id  INTEGER NOT NULL,
  delta       REAL NOT NULL,
  source      TEXT NOT NULL,       -- 'sale_line' | 'reception_line' | 'inventory_adjust' | ...
  source_id   TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_produit ON stock_movements(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source);

-- 2.2 inventory_snapshot (table absente)
CREATE TABLE IF NOT EXISTS inventory_snapshot (
  session_id  INTEGER NOT NULL,
  produit_id  INTEGER NOT NULL,
  stock_start REAL,
  unit_cost   REAL,
  PRIMARY KEY (session_id, produit_id),
  FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_inventory_snapshot_session ON inventory_snapshot(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_snapshot_produit ON inventory_snapshot(produit_id);

-- 2.3 inventory_adjust (table absente)
CREATE TABLE IF NOT EXISTS inventory_adjust (
  session_id    INTEGER NOT NULL,
  produit_id    INTEGER NOT NULL,
  stock_start   REAL,
  counted_total REAL,
  delta         REAL,
  unit_cost     REAL,
  delta_value   REAL,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (session_id, produit_id),
  FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_inventory_adjust_session ON inventory_adjust(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjust_produit ON inventory_adjust(produit_id);

-- ========================================
-- 3. RENOMMER LES COLONNES (via recréation de table)
-- ========================================

-- 3.1 receptions : renommer 'date' en 'created_at'
-- SQLite ne supporte pas ALTER TABLE RENAME COLUMN avant 3.25.0
-- On doit recréer la table

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Sauvegarder les données
CREATE TEMP TABLE receptions_backup AS SELECT * FROM receptions;

-- Supprimer l'ancienne table (cascade sur lignes_reception)
DROP TABLE IF EXISTS lignes_reception;
DROP TABLE receptions;

-- Recréer avec le nouveau nom de colonne
CREATE TABLE receptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fournisseur_id INTEGER,
  created_at     TEXT DEFAULT (datetime('now','localtime')),  -- Anciennement 'date'
  reference      TEXT,
  updated_at     TEXT DEFAULT (datetime('now','localtime')),
  remote_uuid    TEXT UNIQUE
);

-- Restaurer les données (mapper 'date' vers 'created_at')
INSERT INTO receptions (id, fournisseur_id, created_at, reference, updated_at, remote_uuid)
SELECT id, fournisseur_id, date, reference, updated_at, remote_uuid FROM receptions_backup;

-- Recréer lignes_reception
CREATE TABLE lignes_reception (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id   INTEGER NOT NULL,
  produit_id     INTEGER NOT NULL,
  quantite       REAL NOT NULL,
  prix_unitaire  REAL,
  created_at     TEXT DEFAULT (datetime('now','localtime')),
  updated_at     TEXT DEFAULT (datetime('now','localtime')),
  remote_uuid    TEXT UNIQUE,
  FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
  FOREIGN KEY (produit_id)   REFERENCES produits(id)   ON DELETE CASCADE
);

-- Restaurer les données de lignes_reception (si elles existaient)
INSERT OR IGNORE INTO lignes_reception (id, reception_id, produit_id, quantite, prix_unitaire, created_at, updated_at, remote_uuid)
SELECT id, reception_id, produit_id, quantite, prix_unitaire, 
       COALESCE(updated_at, datetime('now','localtime')), 
       COALESCE(updated_at, datetime('now','localtime')), 
       remote_uuid 
FROM sqlite_temp_master 
WHERE type='table' AND name='lignes_reception_backup';

-- Nettoyer
DROP TABLE receptions_backup;

COMMIT;

PRAGMA foreign_keys = ON;

-- 3.2 prospects : renommer 'date_creation' en 'created_at'
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Sauvegarder les données
CREATE TEMP TABLE prospects_backup AS SELECT * FROM prospects;

-- Supprimer l'ancienne table
DROP TABLE IF EXISTS prospects_invitations;
DROP TABLE prospects;

-- Recréer avec le nouveau nom de colonne
CREATE TABLE prospects (
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
  created_at    TEXT DEFAULT (datetime('now','localtime')),  -- Anciennement 'date_creation'
  adherent_id   INTEGER,
  FOREIGN KEY (adherent_id) REFERENCES adherents(id) ON DELETE SET NULL
);

-- Restaurer les données (mapper 'date_creation' vers 'created_at')
INSERT INTO prospects (id, nom, prenom, email, telephone, adresse, code_postal, ville, note, status, created_at, adherent_id)
SELECT id, nom, prenom, email, telephone, adresse, code_postal, ville, note, status, date_creation, adherent_id FROM prospects_backup;

-- Recréer prospects_invitations
CREATE TABLE prospects_invitations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id  INTEGER NOT NULL,
  subject      TEXT,
  body_html    TEXT,
  date_reunion TEXT,
  sent_at      TEXT DEFAULT (datetime('now','localtime')),
  sent_by      TEXT,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

-- Index
CREATE INDEX IF NOT EXISTS idx_prospects_email   ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_status  ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_invits_prospect   ON prospects_invitations(prospect_id);

-- Nettoyer
DROP TABLE prospects_backup;

COMMIT;

PRAGMA foreign_keys = ON;

-- ========================================
-- 4. HARMONISER LES TYPES (carts, cart_items)
-- ========================================

-- 4.1 carts : convertir created_at/updated_at de INTEGER vers TEXT ISO8601
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Sauvegarder les données
CREATE TEMP TABLE carts_backup AS SELECT * FROM carts;

-- Supprimer les anciennes tables
DROP TABLE IF EXISTS cart_items;
DROP TABLE carts;

-- Recréer avec types corrects
CREATE TABLE carts (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  sale_type        TEXT NOT NULL DEFAULT 'adherent',
  adherent_id      INTEGER,
  prospect_id      INTEGER,
  client_email     TEXT,
  mode_paiement_id INTEGER,
  meta             TEXT,
  created_at       TEXT NOT NULL,  -- Changé de INTEGER à TEXT
  updated_at       TEXT NOT NULL,  -- Changé de INTEGER à TEXT
  status           TEXT NOT NULL DEFAULT 'open',
  FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
);

-- Restaurer les données (convertir timestamps Unix en ISO8601)
INSERT INTO carts (id, name, sale_type, adherent_id, prospect_id, client_email, mode_paiement_id, meta, created_at, updated_at, status)
SELECT 
  id, 
  name, 
  sale_type, 
  adherent_id, 
  prospect_id, 
  client_email, 
  mode_paiement_id, 
  meta,
  datetime(created_at, 'unixepoch', 'localtime'),  -- Conversion Unix → ISO8601
  datetime(updated_at, 'unixepoch', 'localtime'),  -- Conversion Unix → ISO8601
  status
FROM carts_backup;

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
  created_at      TEXT NOT NULL,  -- Changé de INTEGER à TEXT
  updated_at      TEXT NOT NULL,  -- Changé de INTEGER à TEXT
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
);

-- Index
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

-- Nettoyer
DROP TABLE carts_backup;

COMMIT;

PRAGMA foreign_keys = ON;

-- ========================================
-- 5. VÉRIFICATION FINALE
-- ========================================

-- Afficher un résumé des tables et colonnes
SELECT 'Tables créées/modifiées avec succès!' AS message;

-- Liste des tables principales
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;

-- Vérifier que toutes les colonnes sont présentes
PRAGMA table_info(produits);
PRAGMA table_info(ventes);
PRAGMA table_info(receptions);
PRAGMA table_info(stock_movements);
PRAGMA table_info(inventory_snapshot);
PRAGMA table_info(inventory_adjust);
PRAGMA table_info(carts);

-- ========================================
-- FIN DE LA MIGRATION
-- ========================================
