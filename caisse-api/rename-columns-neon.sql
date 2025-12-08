-- Script pour renommer les colonnes produit_id en produit_id dans PostgreSQL/Neon
-- À exécuter dans la console SQL de Neon

-- IMPORTANT : Vérifier d'abord quelles colonnes existent vraiment
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('inventory_snapshot', 'inventory_counts', 'inventory_adjust')
  AND (column_name LIKE '%produit%' OR column_name LIKE '%product%')
ORDER BY table_name, column_name;

-- Si les colonnes s'appellent "produit_id", exécuter ces ALTER TABLE :

-- 1. Table inventory_snapshot (si elle a produit_id)
ALTER TABLE inventory_snapshot 
  RENAME COLUMN produit_id TO produit_id;

-- 2. Table inventory_counts (si elle a produit_id)
ALTER TABLE inventory_counts 
  RENAME COLUMN produit_id TO produit_id;

-- 3. Table inventory_adjust (si elle a produit_id)
ALTER TABLE inventory_adjust 
  RENAME COLUMN produit_id TO produit_id;

-- Vérification finale
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('inventory_snapshot', 'inventory_counts', 'inventory_adjust')
  AND (column_name LIKE '%produit%' OR column_name LIKE '%product%')
ORDER BY table_name, column_name;

-- Résultat attendu après modification :
-- table_name          | column_name | data_type
-- --------------------+-------------+-----------
-- inventory_adjust    | produit_id  | uuid
-- inventory_counts    | produit_id  | uuid
-- inventory_snapshot  | produit_id  | uuid
