// dev-seed-defaults.js
import 'dotenv/config';
import pkg from 'pg';
import { seedTenantDefaults } from './seed/seedTenantDefaults.js';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run(tenantId) {
  if (!tenantId) {
    console.error('Usage: node dev-seed-defaults.js <TENANT_ID>');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedTenantDefaults(client, tenantId); // idempotent
    await client.query('COMMIT');
    console.log('Seed par défaut OK pour tenant =', tenantId);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

run(process.argv[2]).catch(console.error);
