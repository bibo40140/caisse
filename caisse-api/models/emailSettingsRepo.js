// models/emailSettingsRepo.js
// Un petit repo SQL; adapte la façon de te connecter (pg/pool) selon ton projet.
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.NEON_DB_URL
});

export async function getEmailSettings(tenantId) {
  const q = `
    SELECT tenant_id, enabled, from_name, from_email, host, port, secure,
           auth_user, auth_pass_enc, reply_to, bcc, updated_at
    FROM email_settings WHERE tenant_id = $1
  `;
  const { rows } = await pool.query(q, [tenantId]);
  return rows[0] || null;
}

export async function upsertEmailSettings(payload) {
  const q = `
    INSERT INTO email_settings
      (tenant_id, enabled, from_name, from_email, host, port, secure, auth_user, auth_pass_enc, reply_to, bcc, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      from_name = EXCLUDED.from_name,
      from_email = EXCLUDED.from_email,
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      secure = EXCLUDED.secure,
      auth_user = EXCLUDED.auth_user,
      auth_pass_enc = EXCLUDED.auth_pass_enc,
      reply_to = EXCLUDED.reply_to,
      bcc = EXCLUDED.bcc,
      updated_at = NOW()
  `;
  const vals = [
    payload.tenant_id,
    !!payload.enabled,
    payload.from_name,
    payload.from_email,
    payload.host,
    payload.port,
    !!payload.secure,
    payload.auth_user,
    payload.auth_pass_enc,
    payload.reply_to || null,
    payload.bcc || null
  ];
  await pool.query(q, vals);
}

export async function getPool() {
  return pool;
}
