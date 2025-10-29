-- init_multitenant_min.sql
-- Extension UUID (pour les ids)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Coeur multi-tenant
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  company_name text,
  logo_url text,
  smtp_host text,
  smtp_port int,
  smtp_user text,
  smtp_pass text,
  smtp_secure boolean,
  from_email text,
  from_name text,
  modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Référentiels et données (scopées par tenant)
CREATE TABLE IF NOT EXISTS unites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS familles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  famille_id uuid REFERENCES familles(id) ON DELETE SET NULL,
  nom text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  categorie_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  contact text,
  email text,
  telephone text,
  adresse text,
  code_postal text,
  ville text,
  label text
);

CREATE TABLE IF NOT EXISTS modes_paiement (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  taux_percent numeric(8,3) NOT NULL DEFAULT 0,
  frais_fixe numeric(12,2) NOT NULL DEFAULT 0,
  actif boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS adherents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text,
  prenom text,
  email1 text,
  email2 text,
  telephone1 text,
  telephone2 text,
  adresse text,
  code_postal text,
  ville text,
  nb_personnes_foyer int,
  tranche_age text,
  droit_entree numeric(12,2),
  date_inscription date,
  archive boolean,
  date_archivage date,
  date_reactivation date
);

CREATE TABLE IF NOT EXISTS produits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  reference text,
  prix numeric(12,2) NOT NULL DEFAULT 0,
  stock numeric(14,3) NOT NULL DEFAULT 0,
  code_barre text,
  unite_id uuid REFERENCES unites(id) ON DELETE SET NULL,
  fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  categorie_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code_barre)
);

-- stock_movements version multi-tenant (utilisée par /pull_refs)
-- ATTENTION: colonnes = produit_id + delta (≠ ancien schéma)
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id uuid NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  delta numeric(14,3) NOT NULL,
  source text NOT NULL,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_unites_tenant ON unites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_familles_tenant ON familles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_tenant ON fournisseurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_produits_tenant ON produits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_modes_paiement_tenant ON modes_paiement(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adherents_tenant ON adherents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant ON stock_movements(tenant_id);
