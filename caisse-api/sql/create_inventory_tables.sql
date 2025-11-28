-- Script pour créer les tables d'inventaire multiposte/multitenant
-- À exécuter sur Neon PostgreSQL

-- 1) Inventaire Sessions
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

-- 2) Inventaire Snapshot (stock au début de l'inventaire)
CREATE TABLE IF NOT EXISTS inventory_snapshot (
  session_id  uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produit_id  uuid        NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  stock_start numeric(14,3),
  unit_cost   numeric(12,2),
  PRIMARY KEY (session_id, produit_id)
);

-- 3) Inventaire Counts (comptages par device)
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

-- 4) Inventaire Adjust (ajustements après finalisation)
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

-- 5) Index pour performance
CREATE INDEX IF NOT EXISTS idx_inv_sessions_tenant     ON inventory_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_status     ON inventory_sessions(status);
CREATE INDEX IF NOT EXISTS idx_inv_snapshot_tenant     ON inventory_snapshot(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_snapshot_produit    ON inventory_snapshot(produit_id);
CREATE INDEX IF NOT EXISTS idx_inv_counts_tenant       ON inventory_counts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_counts_produit      ON inventory_counts(produit_id);
CREATE INDEX IF NOT EXISTS idx_inv_counts_device       ON inventory_counts(device_id);
CREATE INDEX IF NOT EXISTS idx_inv_adjust_tenant       ON inventory_adjust(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_adjust_produit      ON inventory_adjust(produit_id);

-- Vérification
SELECT 'inventory_sessions' as table_name, COUNT(*) as count FROM inventory_sessions
UNION ALL
SELECT 'inventory_snapshot', COUNT(*) FROM inventory_snapshot
UNION ALL
SELECT 'inventory_counts', COUNT(*) FROM inventory_counts
UNION ALL
SELECT 'inventory_adjust', COUNT(*) FROM inventory_adjust;
