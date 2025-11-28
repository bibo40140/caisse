/**
 * Script pour appliquer le schema multitenant complet sur Neon
 * Usage: node apply-full-schema.js
 */

import { pool } from './db/index.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyFullSchema() {
  const client = await pool.connect();
  
  try {
    console.log('[SCHEMA] Application du schema multitenant complet...\n');
    
    // Lire le fichier SQL
    const sqlPath = join(__dirname, 'sql', 'init_multitenant_min.sql');
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    
    console.log('[1/3] Lecture du fichier SQL...');
    console.log(`      Taille: ${(sqlContent.length / 1024).toFixed(2)} KB`);
    console.log(`      Fichier: ${sqlPath}\n`);
    
    // Executer le SQL
    console.log('[2/3] Execution du schema SQL...');
    await client.query(sqlContent);
    console.log('      OK Schema applique avec succes\n');
    
    // Verifier les tables creees
    console.log('[3/3] Verification des tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`\n      Tables presentes (${result.rows.length}):`);
    const importantTables = [
      'tenants', 'users', 'tenant_settings',
      'produits', 'stock_movements',
      'ventes', 'lignes_vente',
      'receptions', 'lignes_reception',
      'inventory_sessions', 'inventory_counts', 'inventory_snapshot', 'inventory_adjust',
      'adherents', 'modes_paiement', 'fournisseurs', 'categories', 'familles', 'unites'
    ];
    
    const existingTables = result.rows.map(r => r.table_name);
    
    for (const table of importantTables) {
      const exists = existingTables.includes(table);
      console.log(`      ${exists ? 'OK' : 'KO'} ${table}`);
    }
    
    // Compter les donnees
    console.log('\n[DONNEES] Verification du contenu...');
    const counts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM tenants) as tenants,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM produits) as produits,
        (SELECT COUNT(*) FROM ventes) as ventes,
        (SELECT COUNT(*) FROM inventory_sessions) as inv_sessions
    `);
    
    const data = counts.rows[0];
    console.log(`      Tenants: ${data.tenants}`);
    console.log(`      Users: ${data.users}`);
    console.log(`      Produits: ${data.produits}`);
    console.log(`      Ventes: ${data.ventes}`);
    console.log(`      Sessions inventaire: ${data.inv_sessions}`);
    
    if (Number(data.tenants) === 0) {
      console.log('\n[WARNING] Aucun tenant trouve.');
      console.log('          Vous devez creer un tenant pour utiliser le systeme.');
      console.log('\n          Exemple:');
      console.log('          INSERT INTO tenants (name) VALUES (\'Mon Association\');');
    }
    
    console.log('\nOK Schema multitenant applique avec succes !');
    
  } catch (e) {
    console.error('\nERREUR lors de l\'application du schema:', e.message);
    console.error('\nDetails:', e);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

// Lancer le script
applyFullSchema()
  .then(() => {
    console.log('\nTermine. Vous pouvez maintenant:');
    console.log('  1. Creer un tenant: node dev-register-tenant.js');
    console.log('  2. Seed les donnees: node dev-seed-defaults.js');
    console.log('  3. Lancer les tests: npm test inventory.test.js');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
