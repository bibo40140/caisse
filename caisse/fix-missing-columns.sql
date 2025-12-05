-- fix-missing-columns.sql
-- Script pour ajouter manuellement les colonnes manquantes
-- Usage: sqlite3 tenant_xxx.db < fix-missing-columns.sql

PRAGMA foreign_keys = OFF;

-- Ajouter created_at sur ventes (sans DEFAULT pour éviter l'erreur)
ALTER TABLE ventes ADD COLUMN created_at TEXT;

-- Ajouter created_at sur produits (sans DEFAULT)
ALTER TABLE produits ADD COLUMN created_at TEXT;

-- Initialiser les valeurs
UPDATE ventes SET created_at = date_vente WHERE created_at IS NULL;
UPDATE produits SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL;

PRAGMA foreign_keys = ON;

SELECT 'Migration terminée avec succès!' AS message;
