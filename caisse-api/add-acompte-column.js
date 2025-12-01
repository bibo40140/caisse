// Script pour ajouter la colonne acompte à la table ventes
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('[MIGRATION] Ajout de la colonne acompte...');
    
    const sql = fs.readFileSync(
      path.join(__dirname, 'sql', 'add_acompte_column.sql'),
      'utf-8'
    );
    
    await pool.query(sql);
    
    console.log('✅ [MIGRATION] Colonne acompte ajoutée avec succès');
    process.exit(0);
  } catch (err) {
    console.error('❌ [MIGRATION] Erreur:', err);
    process.exit(1);
  }
})();
