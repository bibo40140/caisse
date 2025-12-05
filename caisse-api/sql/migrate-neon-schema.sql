-- migrate-neon-schema.sql
-- Migration du schéma PostgreSQL/Neon pour harmonisation avec local
-- Version: 1.0
-- Date: 2025-12-05
-- 
-- IMPORTANT: Ce script est IDEMPOTENT (peut être rejoué sans risque)
-- ATTENTION: Faire une SAUVEGARDE de la base AVANT d'exécuter ce script !

-- ========================================
-- 1. AJOUTER LES COLONNES MANQUANTES
-- ========================================

-- 1.1 produits : ajouter created_at
ALTER TABLE produits ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Initialiser created_at pour les produits existants (= updated_at si elle existe, sinon now)
UPDATE produits SET created_at = COALESCE(updated_at, now()) WHERE created_at IS NULL;

-- 1.2 ventes : ajouter created_at ET updated_at
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Initialiser created_at = date_vente pour les ventes existantes
UPDATE ventes SET created_at = date_vente WHERE created_at IS NULL;
UPDATE ventes SET updated_at = date_vente WHERE updated_at IS NULL;

-- 1.3 lignes_vente : ajouter created_at et updated_at
ALTER TABLE lignes_vente ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE lignes_vente ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Initialiser pour les lignes existantes (utiliser la date de la vente parente)
UPDATE lignes_vente lv
SET created_at = COALESCE(v.date_vente, now())
FROM ventes v
WHERE lv.vente_id = v.id AND lv.created_at IS NULL;

UPDATE lignes_vente SET updated_at = created_at WHERE updated_at IS NULL;

-- 1.4 receptions : ajouter updated_at (created_at existe déjà via 'date')
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Initialiser updated_at = date pour les réceptions existantes
UPDATE receptions SET updated_at = date WHERE updated_at IS NULL;

-- 1.5 lignes_reception : ajouter created_at et updated_at
ALTER TABLE lignes_reception ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE lignes_reception ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Initialiser pour les lignes existantes (utiliser la date de la réception parente)
UPDATE lignes_reception lr
SET created_at = COALESCE(r.date, now())
FROM receptions r
WHERE lr.reception_id = r.id AND lr.created_at IS NULL;

UPDATE lignes_reception SET updated_at = created_at WHERE updated_at IS NULL;

-- 1.6 inventory_counts : ajouter created_at
ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Initialiser created_at pour les comptages existants
UPDATE inventory_counts SET created_at = COALESCE(updated_at, now()) WHERE created_at IS NULL;

-- 1.7 fournisseurs : ajouter referent_id (si utilisé côté local)
-- Note: Vérifier si cette colonne est réellement utilisée avant d'ajouter
-- ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS referent_id uuid REFERENCES adherents(id) ON DELETE SET NULL;

-- 1.8 adherents : ajouter statut (présent côté local)
ALTER TABLE adherents ADD COLUMN IF NOT EXISTS statut text DEFAULT 'actif';

-- Initialiser statut basé sur archive
UPDATE adherents SET statut = CASE WHEN archive = true THEN 'archive' ELSE 'actif' END WHERE statut IS NULL;

-- ========================================
-- 2. RENOMMER LES COLONNES
-- ========================================

-- 2.1 receptions : renommer 'date' en 'created_at'
-- PostgreSQL supporte ALTER TABLE RENAME COLUMN
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'receptions' AND column_name = 'date'
  ) THEN
    ALTER TABLE receptions RENAME COLUMN date TO date_reception;
    -- Ajouter created_at si elle n'existe pas déjà
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'receptions' AND column_name = 'created_at'
    ) THEN
      ALTER TABLE receptions ADD COLUMN created_at timestamptz;
      UPDATE receptions SET created_at = date_reception;
    END IF;
  END IF;
END $$;

-- Note: On garde 'date_reception' comme colonne métier distincte de 'created_at'
-- Cela permet de différencier la date métier (date de la réception) de la date système (création enregistrement)

-- ========================================
-- 3. CRÉER LES TABLES MANQUANTES (si modules prospects utilisé)
-- ========================================

-- 3.1 prospects (optionnel, créer uniquement si module prospects activé)
CREATE TABLE IF NOT EXISTS prospects (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom           text,
  prenom        text,
  email         text,
  telephone     text,
  adresse       text,
  code_postal   text,
  ville         text,
  note          text,
  status        text DEFAULT 'actif',
  created_at    timestamptz DEFAULT now(),
  adherent_id   uuid REFERENCES adherents(id) ON DELETE SET NULL
);

-- Index
CREATE INDEX IF NOT EXISTS idx_prospects_tenant ON prospects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

-- 3.2 prospects_invitations (optionnel)
CREATE TABLE IF NOT EXISTS prospects_invitations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id  uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  subject      text,
  body_html    text,
  date_reunion timestamptz,
  sent_at      timestamptz DEFAULT now(),
  sent_by      text
);

-- Index
CREATE INDEX IF NOT EXISTS idx_invits_tenant ON prospects_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invits_prospect ON prospects_invitations(prospect_id);

-- ========================================
-- 4. AJOUTER LES INDEX MANQUANTS POUR PERFORMANCE
-- ========================================

-- Index sur created_at pour tri chronologique
CREATE INDEX IF NOT EXISTS idx_ventes_created_at ON ventes(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_created_at ON lignes_vente(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_receptions_created_at ON receptions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_created_at ON lignes_reception(tenant_id, created_at);

-- Index sur updated_at pour pull incrémental (optimisation sync)
CREATE INDEX IF NOT EXISTS idx_ventes_updated_at ON ventes(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_updated_at ON lignes_vente(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_receptions_updated_at ON receptions(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_updated_at ON lignes_reception(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_produits_updated_at ON produits(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_adherents_updated_at ON adherents(tenant_id, updated_at) WHERE updated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fournisseurs_updated_at ON fournisseurs(tenant_id, updated_at) WHERE updated_at IS NOT NULL;

-- Index sur inventory_counts
CREATE INDEX IF NOT EXISTS idx_inventory_counts_created_at ON inventory_counts(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_updated_at ON inventory_counts(tenant_id, updated_at);

-- ========================================
-- 5. CRÉER/METTRE À JOUR LES TRIGGERS updated_at
-- ========================================

-- 5.1 Fonction générique set_updated_at (déjà créée dans init_multitenant_min.sql, on la recrée au cas où)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5.2 Triggers pour toutes les tables avec updated_at
DO $$
BEGIN
  -- ventes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ventes' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_ventes_updated ON ventes;
    CREATE TRIGGER trg_ventes_updated
    BEFORE UPDATE ON ventes
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  -- lignes_vente
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lignes_vente' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_lignes_vente_updated ON lignes_vente;
    CREATE TRIGGER trg_lignes_vente_updated
    BEFORE UPDATE ON lignes_vente
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  -- receptions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='receptions' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_receptions_updated ON receptions;
    CREATE TRIGGER trg_receptions_updated
    BEFORE UPDATE ON receptions
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  -- lignes_reception
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lignes_reception' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_lignes_reception_updated ON lignes_reception;
    CREATE TRIGGER trg_lignes_reception_updated
    BEFORE UPDATE ON lignes_reception
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  -- produits
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='produits' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_produits_updated ON produits;
    CREATE TRIGGER trg_produits_updated
    BEFORE UPDATE ON produits
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;

  -- adherents
  DROP TRIGGER IF EXISTS trg_adherents_updated ON adherents;
  CREATE TRIGGER trg_adherents_updated
  BEFORE UPDATE ON adherents
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  -- fournisseurs
  DROP TRIGGER IF EXISTS trg_fournisseurs_updated ON fournisseurs;
  CREATE TRIGGER trg_fournisseurs_updated
  BEFORE UPDATE ON fournisseurs
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  -- inventory_counts
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_counts' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_inventory_counts_updated ON inventory_counts;
    CREATE TRIGGER trg_inventory_counts_updated
    BEFORE UPDATE ON inventory_counts
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END $$;

-- ========================================
-- 6. AJOUTER LES COLONNES updated_at MANQUANTES AUX TABLES DE RÉFÉRENCE
-- ========================================

-- adherents
ALTER TABLE adherents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE adherents SET updated_at = now() WHERE updated_at IS NULL;

-- fournisseurs
ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE fournisseurs SET updated_at = now() WHERE updated_at IS NULL;

-- unites
ALTER TABLE unites ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE unites SET updated_at = now() WHERE updated_at IS NULL;

-- familles
ALTER TABLE familles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE familles SET updated_at = now() WHERE updated_at IS NULL;

-- categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE categories SET updated_at = now() WHERE updated_at IS NULL;

-- modes_paiement
ALTER TABLE modes_paiement ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE modes_paiement SET updated_at = now() WHERE updated_at IS NULL;

-- Triggers pour les tables de référence
DO $$
BEGIN
  -- unites
  DROP TRIGGER IF EXISTS trg_unites_updated ON unites;
  CREATE TRIGGER trg_unites_updated
  BEFORE UPDATE ON unites
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  -- familles
  DROP TRIGGER IF EXISTS trg_familles_updated ON familles;
  CREATE TRIGGER trg_familles_updated
  BEFORE UPDATE ON familles
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  -- categories
  DROP TRIGGER IF EXISTS trg_categories_updated ON categories;
  CREATE TRIGGER trg_categories_updated
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

  -- modes_paiement
  DROP TRIGGER IF EXISTS trg_modes_paiement_updated ON modes_paiement;
  CREATE TRIGGER trg_modes_paiement_updated
  BEFORE UPDATE ON modes_paiement
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
END $$;

-- ========================================
-- 7. VÉRIFICATION FINALE
-- ========================================

-- Afficher un résumé des colonnes ajoutées
SELECT 'Migration Neon terminée avec succès!' AS message;

-- Vérifier les colonnes created_at/updated_at sur les tables principales
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('produits', 'ventes', 'lignes_vente', 'receptions', 'lignes_reception', 'adherents', 'fournisseurs', 'inventory_counts')
  AND column_name IN ('created_at', 'updated_at')
ORDER BY table_name, column_name;

-- Vérifier les index créés
SELECT 
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename IN ('produits', 'ventes', 'lignes_vente', 'receptions', 'lignes_reception', 'adherents', 'fournisseurs', 'inventory_counts')
  AND indexname LIKE '%created_at%' OR indexname LIKE '%updated_at%'
ORDER BY tablename, indexname;

-- ========================================
-- FIN DE LA MIGRATION
-- ========================================
