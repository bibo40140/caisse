// check-tenant-logo.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const result = await pool.query(
      'SELECT company_name, logo_url FROM tenant_settings WHERE tenant_id = $1',
      ['a9e2067c-fd69-4715-bf02-9c6261aa646f']
    );
    
    console.log('Tenant settings:');
    console.log(result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Erreur:', err);
    process.exit(1);
  }
})();
