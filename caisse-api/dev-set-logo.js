/**
 * dev-set-logo.js
 * Set/update tenant logo from a local image file.
 * Usage: node dev-set-logo.js "C:/path/to/logo.png" [Tenant Name]
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const imgPath = process.argv[2];
  const customName = process.argv[3] || null;

  if (!imgPath) {
    console.error('Usage: node dev-set-logo.js "C:/path/to/logo.png" [Tenant Name]');
    process.exit(1);
  }

  let buf;
  try {
    buf = readFileSync(imgPath);
  } catch (e) {
    console.error('Cannot read image file:', e.message);
    process.exit(1);
  }

  const ext = path.extname(imgPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : 'application/octet-stream';

  const client = await pool.connect();
  try {
    // Pick first tenant if no name provided; else pick by name (exact match)
    let tenant;
    if (customName) {
      const r = await client.query(`SELECT id, name FROM tenants WHERE name = $1 LIMIT 1`, [customName]);
      tenant = r.rows[0];
    } else {
      const r = await client.query(`SELECT id, name FROM tenants ORDER BY created_at LIMIT 1`);
      tenant = r.rows[0];
    }
    if (!tenant) {
      console.error('No tenant found. Create one first.');
      process.exit(1);
    }

    await client.query('BEGIN');

    // Ensure table exists (idempotent)
    await client.query(readFileSync(path.join(__dirname, 'sql', 'create_tenant_branding.sql'), 'utf-8'));

    // Upsert branding
    await client.query(
      `INSERT INTO tenant_branding (tenant_id, name, logo_mime, logo_data)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id)
       DO UPDATE SET name = COALESCE($2, tenant_branding.name),
                     logo_mime = EXCLUDED.logo_mime,
                     logo_data = EXCLUDED.logo_data,
                     updated_at = now()`,
      [tenant.id, customName, mime, buf]
    );

    await client.query('COMMIT');
    console.log('Logo updated for tenant:', tenant.name, tenant.id);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed to set logo:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
