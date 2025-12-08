-- 1. Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tables cœur multi-tenant
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
  updated_at   timestamptz NOT NULL DEFAULT now(),
  email_admin_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 3. Référentiels
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
  updated_at   TIMESTAMP DEFAULT NOW(),
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
  date_reactivation    date,
  updated_at           TIMESTAMP DEFAULT NOW()
);

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
  date_creation TIMESTAMP DEFAULT NOW(),
  adherent_id   uuid REFERENCES adherents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS prospects_invitations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id  uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  subject      text,
  body_html    text,
  date_reunion TIMESTAMP,
  sent_at      TIMESTAMP DEFAULT NOW(),
  sent_by      text
);

-- 4. Produits et mouvements
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
  updated_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, reference),
  UNIQUE (tenant_id, code_barre)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id uuid          NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  delta      numeric(14,3) NOT NULL,
  source     text          NOT NULL,
  source_id  text,
  created_at TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Ventes
CREATE TABLE IF NOT EXISTS ventes (
  id               uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  total            numeric(12,2),
  adherent_id      uuid REFERENCES adherents(id)      ON DELETE SET NULL,
  mode_paiement_id uuid REFERENCES modes_paiement(id) ON DELETE SET NULL,
  sale_type        text          NOT NULL,
  client_email     text,
  frais_paiement   numeric(12,2),
  cotisation       numeric(12,2),
  acompte          numeric(12,2) DEFAULT 0,
  date_vente       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
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

-- 6. Réceptions
CREATE TABLE IF NOT EXISTS receptions (
  id             uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fournisseur_id uuid        REFERENCES fournisseurs(id) ON DELETE SET NULL,
  date           TIMESTAMP   NOT NULL DEFAULT NOW(),
  reference      text,
  updated_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lignes_reception (
  id            uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reception_id  uuid          NOT NULL REFERENCES receptions(id) ON DELETE CASCADE,
  produit_id    uuid          NOT NULL REFERENCES produits(id)   ON DELETE CASCADE,
  quantite      numeric(14,3) NOT NULL,
  prix_unitaire numeric(12,2)
);

-- 7. Stock et inventaire
CREATE TABLE IF NOT EXISTS stock_snapshots (
  produit_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (produit_id, tenant_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS current_stock (
  produit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  "user"     text,
  notes      text,
  status     text        NOT NULL DEFAULT 'open',
  started_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  ended_at   TIMESTAMP
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
  updated_at TIMESTAMP    NOT NULL DEFAULT NOW(),
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
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, tenant_id, produit_id)
);

-- 8. Divers
CREATE TABLE IF NOT EXISTS ops (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id   text        NOT NULL,
  op_type     text        NOT NULL,
  entity_type text,
  entity_id   text,
  payload     jsonb,
  applied_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  from_name TEXT,
  from_email TEXT,
  host TEXT,
  port INTEGER,
  secure BOOLEAN DEFAULT false,
  auth_user TEXT,
  auth_pass_enc TEXT,
  reply_to TEXT,
  bcc TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_device_status (
  session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'counting',
  last_activity TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP,
  PRIMARY KEY (session_id, device_id),
  FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name       text,
  logo_mime  text,
  logo_data  bytea,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Ajoute ici les triggers, fonctions, index, et autres scripts spécifiques si besoin.
