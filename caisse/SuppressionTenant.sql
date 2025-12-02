-- ==========================================
-- SUPPRESSION D'UN TENANT ET SES DONNÉES
-- ==========================================
-- Remplacez 'test@example.fr' par l'email du tenant à supprimer

DO $$
DECLARE
    target_tenant_id UUID;
    target_user_id UUID;
    tenant_name TEXT;
BEGIN
    -- 1. Trouver le tenant à supprimer
    SELECT t.id, t.nom INTO target_tenant_id, tenant_name
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE u.email = 'test@example.fr'  -- ⚠️ REMPLACER ICI
    LIMIT 1;

    IF target_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant non trouvé pour l''email: test@example.fr';
    END IF;

    RAISE NOTICE '⚠️  SUPPRESSION DU TENANT: % (ID: %)', tenant_name, target_tenant_id;
    RAISE NOTICE '';

    -- 2. Supprimer toutes les données du tenant
    
    -- Opérations de sync
    DELETE FROM ops WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ ops supprimés';

    -- Mouvements de stock
    DELETE FROM stock_movements WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ stock_movements supprimés';

    -- Inventaire
    DELETE FROM inventory_counts WHERE session_id IN (
        SELECT id FROM inventory_sessions WHERE tenant_id = target_tenant_id
    );
    DELETE FROM inventory_adjust WHERE session_id IN (
        SELECT id FROM inventory_sessions WHERE tenant_id = target_tenant_id
    );
    DELETE FROM inventory_snapshot WHERE session_id IN (
        SELECT id FROM inventory_sessions WHERE tenant_id = target_tenant_id
    );
    DELETE FROM inventory_device_status WHERE tenant_id = target_tenant_id;
    DELETE FROM inventory_sessions WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Inventaire supprimé';

    -- Ventes
    DELETE FROM lignes_vente WHERE vente_id IN (
        SELECT id FROM ventes WHERE tenant_id = target_tenant_id
    );
    DELETE FROM ventes WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Ventes supprimées';

    -- Réceptions
    DELETE FROM lignes_reception WHERE reception_id IN (
        SELECT id FROM receptions WHERE tenant_id = target_tenant_id
    );
    DELETE FROM receptions WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Réceptions supprimées';

    -- Produits
    DELETE FROM produits WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Produits supprimés';

    -- Adhérents
    DELETE FROM adherents WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Adhérents supprimés';

    -- Fournisseurs
    DELETE FROM fournisseurs WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Fournisseurs supprimés';

    -- Familles et catégories
    DELETE FROM categories WHERE tenant_id = target_tenant_id;
    DELETE FROM familles WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Familles et catégories supprimées';

    -- Modes de paiement
    DELETE FROM modes_paiement WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Modes paiement supprimés';

    -- Settings
    DELETE FROM email_settings WHERE tenant_id = target_tenant_id;
    DELETE FROM tenant_settings WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Settings supprimés';

    -- Utilisateurs
    DELETE FROM users WHERE tenant_id = target_tenant_id;
    RAISE NOTICE '✓ Utilisateurs supprimés';

    -- 3. Supprimer le tenant
    DELETE FROM tenants WHERE id = target_tenant_id;
    RAISE NOTICE '✓ Tenant supprimé';

    RAISE NOTICE '';
    RAISE NOTICE '🎉 Tenant "%" complètement supprimé!', tenant_name;
END $$;