-- Migration: Renommer produit_id en produit_id dans inventory_snapshot pour cohérence
-- À exécuter sur la base PostgreSQL (Neon)

BEGIN;

-- Renommer la colonne si elle existe avec l'ancien nom
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inventory_snapshot' 
        AND column_name = 'produit_id'
    ) THEN
        ALTER TABLE inventory_snapshot RENAME COLUMN produit_id TO produit_id;
        RAISE NOTICE 'Colonne produit_id renommée en produit_id dans inventory_snapshot';
    ELSE
        RAISE NOTICE 'La colonne produit_id existe déjà ou produit_id n''existe pas';
    END IF;
END $$;

COMMIT;
