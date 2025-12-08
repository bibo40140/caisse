// Script pour appliquer la migration de renommage de colonne inventory_snapshot
import { pool } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  console.log('🔧 Démarrage de la migration inventory_snapshot...');
  
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'sql', 'fix_inventory_snapshot_column.sql'),
      'utf8'
    );
    
    await client.query(sql);
    console.log('✅ Migration réussie !');
  } catch (err) {
    console.error('❌ Erreur de migration:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
