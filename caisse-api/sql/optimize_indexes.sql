-- ============================================================
-- OPTIMISATION DES INDEX - POSTGRESQL (serveur)
-- ============================================================
-- Index pour améliorer les performances des requêtes fréquentes

-- Index sur tenant_id (filtrage principal de TOUTES les requêtes)
CREATE INDEX IF NOT EXISTS idx_ventes_tenant_id ON ventes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receptions_tenant_id ON receptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_produits_tenant_id ON produits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_tenant_id ON fournisseurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adherents_tenant_id ON adherents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON stock_movements(tenant_id);

-- Index sur updated_at pour le pull incrémental (WHERE updated_at > $since)
CREATE INDEX IF NOT EXISTS idx_ventes_updated_at ON ventes(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_receptions_updated_at ON receptions(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_produits_updated_at ON produits(tenant_id, updated_at);

-- Index sur created_at pour tri chronologique
CREATE INDEX IF NOT EXISTS idx_ventes_created_at ON ventes(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_receptions_created_at ON receptions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(tenant_id, created_at);

-- Index sur les clés étrangères pour les JOIN rapides
CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente_id ON lignes_vente(vente_id);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_produit_id ON lignes_vente(produit_id);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_reception_id ON lignes_reception(reception_id);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_produit_id ON lignes_reception(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_produit_id ON stock_movements(tenant_id, produit_id);

-- Index sur remote_uuid pour éviter les doublons lors du push
CREATE INDEX IF NOT EXISTS idx_ops_queue_remote_uuid ON ops_queue(remote_uuid);
CREATE INDEX IF NOT EXISTS idx_stock_movements_remote_uuid ON stock_movements(remote_uuid);

-- Index composite pour les queries de sync avec pagination
CREATE INDEX IF NOT EXISTS idx_ventes_sync ON ventes(tenant_id, updated_at, date, id);
CREATE INDEX IF NOT EXISTS idx_receptions_sync ON receptions(tenant_id, updated_at, date, id);

-- Index sur source_id pour retrouver rapidement les mouvements liés
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(tenant_id, source, source_id);

-- Index pour les recherches par code_barre (scan produit rapide)
CREATE INDEX IF NOT EXISTS idx_produits_code_barre ON produits(tenant_id, code_barre) WHERE code_barre IS NOT NULL;

-- Index pour recherches par référence
CREATE INDEX IF NOT EXISTS idx_produits_reference ON produits(tenant_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receptions_reference ON receptions(tenant_id, reference) WHERE reference IS NOT NULL;

-- ============================================================
-- VACUUM et ANALYZE pour PostgreSQL
-- ============================================================
-- À exécuter périodiquement pour maintenir les performances
-- VACUUM ANALYZE ventes;
-- VACUUM ANALYZE receptions;
-- VACUUM ANALYZE produits;
-- VACUUM ANALYZE stock_movements;
-- VACUUM ANALYZE lignes_vente;
-- VACUUM ANALYZE lignes_reception;
