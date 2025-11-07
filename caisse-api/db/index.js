// caisse-api/db/index.js
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute-le dans .env');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false },
});

/**
 * N'essaie PLUS de créer tenant_settings ici (source de vérité = init_multitenant_min.sql).
 * On se contente d'utilitaires idempotents (fonction de trigger, index).
 */
export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fonction/trigger updated_at (ok même si colonne existe déjà)
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Si un trigger existe déjà avec un autre nom, on ignore. On crée un trigger standard si la colonne existe.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name='tenant_settings' AND column_name='updated_at'
        ) THEN
          DROP TRIGGER IF EXISTS trg_tenant_settings_updated ON tenant_settings;
          CREATE TRIGGER trg_tenant_settings_updated
          BEFORE UPDATE ON tenant_settings
          FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
        END IF;
      END$$;
    `);

    // Petit index optionnel (idempotent) si tu filtres un jour dessus
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind='r' AND c.relname='tenant_settings'
        ) THEN
          CREATE INDEX IF NOT EXISTS idx_tenant_settings_updated_at
          ON tenant_settings (updated_at);
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    console.log('[db] Schéma utilitaires OK (tenant_settings laissé au SQL init)');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[db] ensureSchema error:', e);
    throw e;
  } finally {
    client.release();
  }
}

export async function ensureTenantSettingsRow(tenantId) {
  if (!tenantId) return;
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

// best effort
ensureSchema().catch(() => {});
