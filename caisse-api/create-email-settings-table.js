// Script pour créer la table email_settings
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false }
});

async function createEmailSettingsTable() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATION] Création de la table email_settings...');
    
    const sql = readFileSync(
      join(__dirname, 'sql', 'create_email_settings.sql'),
      'utf-8'
    );
    
    await client.query(sql);
    
    console.log('✅ [MIGRATION] Table email_settings créée avec succès');
  } catch (error) {
    console.error('❌ [MIGRATION] Erreur:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createEmailSettingsTable();
