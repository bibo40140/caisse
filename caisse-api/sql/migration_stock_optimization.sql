-- ============================================================================
-- MIGRATION: Optimisation de la synchronisation du stock
-- Date: 2025-12-04
-- ============================================================================

-- 1. Table pour les snapshots quotidiens de stock
CREATE TABLE IF NOT EXISTS stock_snapshots (
  product_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (product_id, tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshots_tenant_date 
  ON stock_snapshots(tenant_id, snapshot_date DESC);

COMMENT ON TABLE stock_snapshots IS 
  'Snapshots quotidiens du stock pour optimiser le pull initial';

-- 2. Table pour le stock actuel (calculé)
CREATE TABLE IF NOT EXISTS current_stock (
  product_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_current_stock_tenant 
  ON current_stock(tenant_id);

COMMENT ON TABLE current_stock IS 
  'Stock actuel de chaque produit, recalculé quotidiennement';

-- 3. Ajouter des colonnes pour tracking de synchronisation
-- (Si elles n'existent pas déjà)

-- Sur stock_movements
ALTER TABLE stock_movements 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sur ventes (updated_at devrait exister, mais on vérifie)
ALTER TABLE ventes 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sur receptions (updated_at devrait exister, mais on vérifie)
ALTER TABLE receptions 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sur adherents (updated_at devrait exister, mais on vérifie)
ALTER TABLE adherents 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sur fournisseurs
ALTER TABLE fournisseurs 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Sur produits (updated_at devrait exister, mais on vérifie)
ALTER TABLE produits 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- 4. Index pour les requêtes incrémentales
-- Note: Créés après l'ajout des colonnes updated_at

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_created 
  ON stock_movements(tenant_id, created_at DESC);

-- Index sur updated_at seulement si la colonne existe
-- (elle vient d'être créée ci-dessus)

CREATE INDEX IF NOT EXISTS idx_ventes_tenant_updated 
  ON ventes(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_receptions_tenant_updated 
  ON receptions(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_adherents_tenant_updated 
  ON adherents(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fournisseurs_tenant_updated 
  ON fournisseurs(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_produits_tenant_updated 
  ON produits(tenant_id, updated_at DESC);

-- 4.5 Initialiser updated_at pour les enregistrements existants qui n'en ont pas
-- Utiliser NOW() comme valeur par défaut

UPDATE adherents 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

UPDATE fournisseurs 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

UPDATE produits 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

UPDATE ventes 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

UPDATE receptions 
SET updated_at = NOW() 
WHERE updated_at IS NULL;

-- 5. Fonction pour initialiser current_stock depuis stock_movements
CREATE OR REPLACE FUNCTION refresh_current_stock(p_tenant_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Si tenant_id fourni, refresh seulement ce tenant
  IF p_tenant_id IS NOT NULL THEN
    INSERT INTO current_stock (product_id, tenant_id, quantity, last_updated)
    SELECT 
      sm.produit_id,
      sm.tenant_id,
      SUM(sm.delta) as quantity,
      NOW()
    FROM stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
    GROUP BY sm.produit_id, sm.tenant_id
    ON CONFLICT (product_id) DO UPDATE
    SET 
      quantity = EXCLUDED.quantity,
      last_updated = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;
  
  -- Sinon, refresh tous les tenants
  INSERT INTO current_stock (product_id, tenant_id, quantity, last_updated)
  SELECT 
    sm.produit_id,
    sm.tenant_id,
    SUM(sm.delta) as quantity,
    NOW()
  FROM stock_movements sm
  GROUP BY sm.produit_id, sm.tenant_id
  ON CONFLICT (product_id) DO UPDATE
  SET 
    quantity = EXCLUDED.quantity,
    last_updated = NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_current_stock IS 
  'Recalcule le stock actuel depuis stock_movements. Peut être appelé pour un tenant spécifique ou tous.';

-- 6. Fonction pour créer un snapshot quotidien
CREATE OR REPLACE FUNCTION create_daily_snapshot(p_tenant_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_snapshot_date DATE := CURRENT_DATE;
BEGIN
  -- Si tenant_id fourni, snapshot seulement ce tenant
  IF p_tenant_id IS NOT NULL THEN
    INSERT INTO stock_snapshots (product_id, tenant_id, snapshot_date, quantity, created_at)
    SELECT 
      product_id,
      tenant_id,
      v_snapshot_date,
      quantity,
      NOW()
    FROM current_stock
    WHERE tenant_id = p_tenant_id
    ON CONFLICT (product_id, tenant_id, snapshot_date) DO UPDATE
    SET 
      quantity = EXCLUDED.quantity,
      created_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;
  
  -- Sinon, snapshot tous les tenants
  INSERT INTO stock_snapshots (product_id, tenant_id, snapshot_date, quantity, created_at)
  SELECT 
    product_id,
    tenant_id,
    v_snapshot_date,
    quantity,
    NOW()
  FROM current_stock
  ON CONFLICT (product_id, tenant_id, snapshot_date) DO UPDATE
  SET 
    quantity = EXCLUDED.quantity,
    created_at = NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_daily_snapshot IS 
  'Crée un snapshot quotidien du stock actuel. À appeler via cron chaque nuit.';

-- 7. Fonction de cleanup des vieux movements (TTL 90 jours)
CREATE OR REPLACE FUNCTION cleanup_old_stock_movements(p_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_cutoff_date TIMESTAMP;
BEGIN
  v_cutoff_date := NOW() - (p_days || ' days')::INTERVAL;
  
  DELETE FROM stock_movements
  WHERE created_at < v_cutoff_date;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RAISE NOTICE 'Supprimé % mouvements de stock antérieurs à %', v_count, v_cutoff_date;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_stock_movements IS 
  'Supprime les mouvements de stock de plus de X jours (défaut: 90). À appeler via cron.';

-- 8. Fonction de cleanup des vieux snapshots (garder 2 ans)
CREATE OR REPLACE FUNCTION cleanup_old_snapshots(p_years INTEGER DEFAULT 2)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_cutoff_date DATE;
BEGIN
  v_cutoff_date := CURRENT_DATE - (p_years || ' years')::INTERVAL;
  
  DELETE FROM stock_snapshots
  WHERE snapshot_date < v_cutoff_date;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RAISE NOTICE 'Supprimé % snapshots antérieurs à %', v_count, v_cutoff_date;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_snapshots IS 
  'Supprime les snapshots de plus de X années (défaut: 2). À appeler via cron.';

-- 9. Initialiser current_stock avec les données existantes
-- (À exécuter une seule fois lors de la migration)
SELECT refresh_current_stock();

-- 10. Créer le premier snapshot
-- (À exécuter une seule fois lors de la migration)
SELECT create_daily_snapshot();

-- ============================================================================
-- FIN DE LA MIGRATION
-- ============================================================================

-- Pour vérifier l'installation:
-- SELECT * FROM stock_snapshots LIMIT 10;
-- SELECT * FROM current_stock LIMIT 10;
-- SELECT refresh_current_stock(); -- Force refresh
-- SELECT create_daily_snapshot(); -- Force snapshot
