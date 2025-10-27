-- ============ BASE CLEAN ============

-- (Si tu as déjà fait DROP SCHEMA public CASCADE; CREATE SCHEMA public; passe)
-- Active l’extension pour UUID si dispo
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============ TABLES RÉFÉRENTIELS ============

CREATE TABLE IF NOT EXISTS unites (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS familles (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  famille_id INT REFERENCES familles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS adherents (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT,
  email1 TEXT,
  email2 TEXT,
  telephone1 TEXT,
  telephone2 TEXT,
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  nb_personnes_foyer INT,
  tranche_age TEXT,
  droit_entree NUMERIC(12,2),
  date_inscription DATE,
  archive BOOLEAN DEFAULT FALSE,
  date_archivage DATE,
  date_reactivation DATE
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  telephone TEXT,
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  categorie_id INT REFERENCES categories(id) ON DELETE SET NULL,
  referent_id INT REFERENCES adherents(id) ON DELETE SET NULL,
  label TEXT
);

CREATE TABLE IF NOT EXISTS modes_paiement (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  taux_percent NUMERIC(8,4) DEFAULT 0,
  frais_fixe NUMERIC(12,4) DEFAULT 0,
  actif BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS produits (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  reference TEXT,
  prix NUMERIC(12,4) DEFAULT 0,
  stock NUMERIC(14,4) DEFAULT 0,         -- valeur legacy / fallback
  code_barre TEXT,
  unite_id INT REFERENCES unites(id) ON DELETE SET NULL,
  fournisseur_id INT REFERENCES fournisseurs(id) ON DELETE SET NULL,
  categorie_id INT REFERENCES categories(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============ VENTES & RECEPTIONS ============

CREATE TABLE IF NOT EXISTS ventes (
  id BIGSERIAL PRIMARY KEY,
  total NUMERIC(14,4),
  adherent_id INT REFERENCES adherents(id) ON DELETE SET NULL,
  mode_paiement_id INT REFERENCES modes_paiement(id) ON DELETE SET NULL,
  sale_type TEXT,            -- 'adherent' | 'prospect' | 'exterieur'
  client_email TEXT,
  frais_paiement NUMERIC(12,4),
  cotisation NUMERIC(12,4),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lignes_vente (
  id BIGSERIAL PRIMARY KEY,
  vente_id BIGINT REFERENCES ventes(id) ON DELETE CASCADE,
  produit_id INT REFERENCES produits(id) ON DELETE SET NULL,
  quantite NUMERIC(14,4) NOT NULL,
  prix NUMERIC(12,4) NOT NULL,           -- PU appliqué
  prix_unitaire NUMERIC(12,4),
  remise_percent NUMERIC(8,4) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_vente ON lignes_vente(vente_id);
CREATE INDEX IF NOT EXISTS idx_lignes_vente_prod  ON lignes_vente(produit_id);

CREATE TABLE IF NOT EXISTS receptions (
  id BIGSERIAL PRIMARY KEY,
  fournisseur_id INT REFERENCES fournisseurs(id) ON DELETE SET NULL,
  date TIMESTAMPTZ DEFAULT now(),
  reference TEXT
);

CREATE TABLE IF NOT EXISTS lignes_reception (
  id BIGSERIAL PRIMARY KEY,
  reception_id BIGINT REFERENCES receptions(id) ON DELETE CASCADE,
  produit_id INT REFERENCES produits(id) ON DELETE SET NULL,
  quantite NUMERIC(14,4) NOT NULL,
  prix_unitaire NUMERIC(12,4)
);
CREATE INDEX IF NOT EXISTS idx_lignes_rec_rec   ON lignes_reception(reception_id);
CREATE INDEX IF NOT EXISTS idx_lignes_rec_prod  ON lignes_reception(produit_id);

-- ============ STOCK MOVEMENTS (SOURCE DE VÉRITÉ) ============

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  qty_change NUMERIC(14,4) NOT NULL,
  reason TEXT,                              -- sale | reception | inventory | adjustment | stock_set
  source_type TEXT,                         -- sale_line | reception_line | inventory_finalize | stock_set ...
  source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_sm_prod ON stock_movements(product_id);

-- ============ INVENTAIRE ============

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  "user" TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | finalizing | closed
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_snapshot (
  session_id BIGINT REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  product_id INT REFERENCES produits(id) ON DELETE CASCADE,
  stock_start NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,4),
  PRIMARY KEY (session_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  session_id BIGINT REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  product_id INT REFERENCES produits(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  "user" TEXT,
  qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (session_id, product_id, device_id)
);

CREATE TABLE IF NOT EXISTS inventory_adjust (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  product_id INT REFERENCES produits(id) ON DELETE CASCADE,
  stock_start NUMERIC(14,4) NOT NULL,
  counted_total NUMERIC(14,4) NOT NULL,
  delta NUMERIC(14,4) NOT NULL,
  unit_cost NUMERIC(12,4),
  delta_value NUMERIC(14,4)
);

-- ============ OPS JOURNAL SERVEUR (IDEMPOTENCE PUSH) ============

CREATE TABLE IF NOT EXISTS ops (
  id TEXT PRIMARY KEY,               -- id de l'op locale (device)
  device_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload JSONB,
  applied_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ops_applied ON ops(applied_at);

-- ============ SEQUENCES ALIGN (facultatif) ============

SELECT setval(pg_get_serial_sequence('unites','id'),       COALESCE((SELECT MAX(id) FROM unites),0));
SELECT setval(pg_get_serial_sequence('familles','id'),     COALESCE((SELECT MAX(id) FROM familles),0));
SELECT setval(pg_get_serial_sequence('categories','id'),   COALESCE((SELECT MAX(id) FROM categories),0));
SELECT setval(pg_get_serial_sequence('adherents','id'),    COALESCE((SELECT MAX(id) FROM adherents),0));
SELECT setval(pg_get_serial_sequence('fournisseurs','id'), COALESCE((SELECT MAX(id) FROM fournisseurs),0));
SELECT setval(pg_get_serial_sequence('produits','id'),     COALESCE((SELECT MAX(id) FROM produits),0));
