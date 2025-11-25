-- migrate-receptions-fk.sql
-- Script SQL pour supprimer la contrainte FK sur receptions.fournisseur_id
-- À exécuter avec sqlite3 CLI : sqlite3 db/tenant_XXX.db < migrate-receptions-fk.sql

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Sauvegarder les données existantes
CREATE TABLE IF NOT EXISTS receptions_backup AS SELECT * FROM receptions;
CREATE TABLE IF NOT EXISTS lignes_reception_backup AS SELECT * FROM lignes_reception;

-- Supprimer les anciennes tables
DROP TABLE IF EXISTS lignes_reception;
DROP TABLE IF EXISTS receptions;

-- Recréer la table receptions SANS FK sur fournisseur_id
CREATE TABLE receptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fournisseur_id INTEGER,
  date           TEXT DEFAULT (datetime('now','localtime')),
  reference      TEXT,
  updated_at     TEXT DEFAULT (datetime('now','localtime')),
  remote_uuid    TEXT UNIQUE
);

-- Recréer lignes_reception
CREATE TABLE lignes_reception (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id   INTEGER NOT NULL,
  produit_id     INTEGER NOT NULL,
  quantite       REAL NOT NULL,
  prix_unitaire  REAL,
  updated_at     TEXT DEFAULT (datetime('now','localtime')),
  remote_uuid    TEXT UNIQUE,
  FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
  FOREIGN KEY (produit_id)   REFERENCES produits(id)   ON DELETE CASCADE
);

-- Restaurer les données
INSERT INTO receptions (id, fournisseur_id, date, reference, updated_at, remote_uuid)
SELECT id, fournisseur_id, date, reference, updated_at, remote_uuid FROM receptions_backup;

INSERT INTO lignes_reception (id, reception_id, produit_id, quantite, prix_unitaire, updated_at, remote_uuid)
SELECT id, reception_id, produit_id, quantite, prix_unitaire, updated_at, remote_uuid FROM lignes_reception_backup;

-- Supprimer les sauvegardes
DROP TABLE receptions_backup;
DROP TABLE lignes_reception_backup;

COMMIT;

PRAGMA foreign_keys = ON;

.print "✅ Migration terminée avec succès !"
