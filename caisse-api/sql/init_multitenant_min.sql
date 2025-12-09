-- init_multitenant_min.sql
-- Schéma multi-tenant pour Coopaz (Neon/PostgreSQL)
-- Version UUID partout (produits, ventes, réceptions, inventaires, ...)

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2) Coeur multi-tenant
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'admin',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- 3) Paramètres / branding par tenant
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id    uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  company_name text,
  logo_url     text,
  smtp_host    text,
  smtp_port    int,
  smtp_user    text,
  smtp_pass    text,
  smtp_secure  boolean,
  from_email   text,
  from_name    text,
  modules      jsonb NOT NULL DEFAULT '{}'::jsonb,
  modules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  smtp_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarded    boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- trigger de mise à jour du champ updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tenant_settings' AND column_name='updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_tenant_settings_updated ON tenant_settings;
    CREATE TRIGGER trg_tenant_settings_updated
    BEFORE UPDATE ON tenant_settings
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
  END IF;
END$$;

-- 4) Référentiels (UUID) scopés par tenant

CREATE TABLE IF NOT EXISTS unites (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom        text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS familles (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom        text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  famille_id  uuid REFERENCES familles(id) ON DELETE SET NULL,
  nom         text NOT NULL,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom          text NOT NULL,
  categorie_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  contact      text,
  email        text,
  telephone    text,
  adresse      text,
  code_postal  text,
  ville        text,
  label        text,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS modes_paiement (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom          text NOT NULL,
  taux_percent numeric(8,3)  NOT NULL DEFAULT 0,
  frais_fixe   numeric(12,2) NOT NULL DEFAULT 0,
  actif        boolean       NOT NULL DEFAULT true,
  UNIQUE (tenant_id, nom)
);

CREATE TABLE IF NOT EXISTS adherents (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom                  text,
  prenom               text,
  email1               text,
  email2               text,
  telephone1           text,
  telephone2           text,
  adresse              text,
  code_postal          text,
  ville                text,
  nb_personnes_foyer   int,
  tranche_age          text,
  droit_entree         numeric(12,2),
  date_inscription     date,
  archive              boolean,
  date_archivage       date,
  date_reactivation    date
);

-- 5) Produits (UUID côté Neon, les IDs locaux restent des INTEGER dans SQLite
--    et seront mappés via produits.remote_uuid dans la base locale)

CREATE TABLE IF NOT EXISTS produits (
  id             uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom            text          NOT NULL,
  reference      text,
  prix           numeric(12,2) NOT NULL DEFAULT 0,
  stock          numeric(14,3) NOT NULL DEFAULT 0,
  code_barre     text,
  unite_id       uuid REFERENCES unites(id)       ON DELETE SET NULL,
  fournisseur_id uuid REFERENCES fournisseurs(id) ON DELETE SET NULL,
  categorie_id   uuid REFERENCES categories(id)   ON DELETE SET NULL,
  deleted        boolean       NOT NULL DEFAULT false,
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference),
  UNIQUE (tenant_id, code_barre)
);

-- 6) Mouvements de stock (agrégés pour le stock courant)

CREATE TABLE IF NOT EXISTS stock_movements (
  id         uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id uuid          NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  delta      numeric(14,3) NOT NULL,
  source     text          NOT NULL,      -- 'sale_line' | 'reception_line' | 'inventory_adjust' | ...
  source_id  text,
  created_at timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_stock_movements_source
  ON stock_movements(tenant_id, source_id)
  WHERE source_id IS NOT NULL;

-- 7) Historique des ventes (entêtes + lignes)

CREATE TABLE IF NOT EXISTS ventes (
  id               uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  total            numeric(12,2),
  adherent_id      uuid REFERENCES adherents(id)      ON DELETE SET NULL,
  mode_paiement_id uuid REFERENCES modes_paiement(id) ON DELETE SET NULL,
  sale_type        text          NOT NULL,   -- 'adherent' | 'exterieur' | 'prospect'
  client_email     text,
  frais_paiement   numeric(12,2),
  cotisation       numeric(12,2),
  date_vente       timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lignes_vente (
  id             uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vente_id       uuid          NOT NULL REFERENCES ventes(id)   ON DELETE CASCADE,
  produit_id     uuid          NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  quantite       numeric(14,3) NOT NULL,
  prix           numeric(12,2) NOT NULL,
  prix_unitaire  numeric(12,2),
  remise_percent numeric(5,2)  NOT NULL DEFAULT 0
);

-- 8) Réceptions + lignes

CREATE TABLE IF NOT EXISTS receptions (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fournisseur_id uuid        REFERENCES fournisseurs(id) ON DELETE SET NULL,
  date           timestamptz NOT NULL DEFAULT now(),
  reference      text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lignes_reception (
  id            uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reception_id  uuid          NOT NULL REFERENCES receptions(id) ON DELETE CASCADE,
  produit_id    uuid          NOT NULL REFERENCES produits(id)   ON DELETE CASCADE,
  quantite      numeric(14,3) NOT NULL,
  prix_unitaire numeric(12,2)
);

-- 9) Journal d'opérations de sync

CREATE TABLE IF NOT EXISTS ops (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id   text        NOT NULL,
  op_type     text        NOT NULL,
  entity_type text,
  entity_id   text,
  payload     jsonb,
  applied_at  timestamptz
);

-- 10) Inventaire (sessions, snapshots, comptages, ajustements)

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  "user"     text,
  notes      text,
  status     text        NOT NULL DEFAULT 'open', -- 'open' | 'finalizing' | 'closed'
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS inventory_snapshot (
  session_id  uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id  uuid        NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  stock_start numeric(14,3),
  unit_cost   numeric(12,2),
  PRIMARY KEY (session_id, produit_id)
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  session_id uuid         NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  tenant_id  uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id uuid         NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  device_id  text         NOT NULL,
  "user"     text,
  qty        numeric(14,3) NOT NULL,
  updated_at timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, produit_id, device_id)
);

CREATE TABLE IF NOT EXISTS inventory_adjust (
  session_id    uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id    uuid        NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  stock_start   numeric(14,3),
  counted_total numeric(14,3),
  delta         numeric(14,3),
  unit_cost     numeric(12,2),
  delta_value   numeric(14,3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, tenant_id, produit_id)
);

-- Statut des devices lors d'un inventaire multiposte
CREATE TABLE IF NOT EXISTS inventory_device_status (
  session_id   uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    text        NOT NULL,
  status       text        DEFAULT 'counting', -- 'counting' | 'finished'
  last_activity timestamptz DEFAULT now(),
  finished_at  timestamptz,
  PRIMARY KEY (session_id, device_id)
);

-- 11) Index divers

CREATE INDEX IF NOT EXISTS idx_unites_tenant           ON unites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_familles_tenant         ON familles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant       ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_tenant     ON fournisseurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_modes_paiement_tenant   ON modes_paiement(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adherents_tenant        ON adherents(tenant_id);

CREATE INDEX IF NOT EXISTS idx_produits_tenant         ON produits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_produits_categorie_id   ON produits(categorie_id);
CREATE INDEX IF NOT EXISTS idx_produits_fournisseur_id ON produits(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_produits_code_barre     ON produits(code_barre);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant  ON stock_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_produit ON stock_movements(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);

CREATE INDEX IF NOT EXISTS idx_ventes_tenant           ON ventes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ventes_date             ON ventes(tenant_id, date_vente);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_tenant     ON lignes_vente(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente      ON lignes_vente(vente_id);

CREATE INDEX IF NOT EXISTS idx_receptions_tenant       ON receptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_tenant ON lignes_reception(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lignes_reception_rec    ON lignes_reception(reception_id);

CREATE INDEX IF NOT EXISTS idx_ops_tenant              ON ops(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ops_tenant_optype       ON ops(tenant_id, op_type);

CREATE INDEX IF NOT EXISTS idx_inv_sessions_tenant     ON inventory_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_snapshot_tenant     ON inventory_snapshot(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_counts_tenant       ON inventory_counts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_adjust_tenant       ON inventory_adjust(tenant_id);
