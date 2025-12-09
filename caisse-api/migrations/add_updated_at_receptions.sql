-- Migration: Ajouter colonne updated_at à receptions pour la sync incrémentale
ALTER TABLE receptions
ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Index pour accélérer le tri/filtrage
CREATE INDEX IF NOT EXISTS idx_receptions_updated_at ON receptions(tenant_id, updated_at);
