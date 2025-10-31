// caisse-api/db/index.js
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute-le dans .env');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En prod (Neon/Supabase), SSL est nécessaire. Pour du local pur PG, passe PGSSL=0 si besoin.
  ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false },
});

/**
 * Crée le schéma nécessaire si absent (idempotent).
 * - Table tenant_settings (une ligne par tenant)
 * - Cols: onboarded, modules_json, smtp_json, logo_url, timestamps
 * - Trigger pour updated_at
 */
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Table sans contrainte FK pour éviter d’imposer une table tenants ici.
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id    UUID PRIMARY KEY,
        onboarded    BOOLEAN NOT NULL DEFAULT FALSE,
        modules_json JSONB  NOT NULL DEFAULT '{}'::jsonb,
        smtp_json    JSONB  NOT NULL DEFAULT '{}'::jsonb,
        logo_url     TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Fonction/trigger pour mettre à jour updated_at automatiquement
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trg_tenant_settings_updated ON tenant_settings;
    `);

    await client.query(`
      CREATE TRIGGER trg_tenant_settings_updated
      BEFORE UPDATE ON tenant_settings
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
    `);

    // Petit index utile si tu fais des filtres sur onboarded
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_settings_onboarded
      ON tenant_settings (onboarded);
    `);

    await client.query('COMMIT');
    console.log('[db] Schéma tenant_settings OK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[db] ensureSchema error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Garantit qu’une ligne existe pour ce tenant (utile avant un UPDATE).
 */
export async function ensureTenantSettingsRow(tenantId) {
  if (!tenantId) return;
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

// Initialise le schéma au chargement du module (best effort)
ensureSchema().catch(() => {});
