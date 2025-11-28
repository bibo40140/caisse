/**
 * Script pour reinitialiser completement la base Neon en mode multitenant
 * ATTENTION: Ce script SUPPRIME toutes les donnees existantes !
 * Usage: node reset-and-apply-schema.js
 */

import { pool } from './db/index.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function resetAndApplySchema() {
  const client = await pool.connect();
  
  try {
    console.log('\n==========================================================');
    console.log('ATTENTION: Ce script va SUPPRIMER toutes les donnees !');
    console.log('==========================================================\n');
    
    const answer = await askQuestion('Continuer ? (oui/non): ');
    
    if (answer.toLowerCase() !== 'oui') {
      console.log('Annule.');
      process.exit(0);
    }
    
    console.log('\n[RESET] Suppression des tables existantes...\n');
    
    // Drop toutes les tables dans l'ordre inverse des dependances
    const tablesToDrop = [
      'ops',
      'inventory_adjust',
      'inventory_counts',
      'inventory_snapshot',
      'inventory_sessions',
      'lignes_reception',
      'receptions',
      'lignes_vente',
      'ventes',
      'stock_movements',
      'produits',
      'adherents',
      'modes_paiement',
      'fournisseurs',
      'categories',
      'familles',
      'unites',
      'tenant_settings',
      'users',
      'tenants'
    ];
    
    for (const table of tablesToDrop) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  OK Suppression ${table}`);
      } catch (e) {
        console.log(`  SKIP ${table} (n'existe pas)`);
      }
    }
    
    // Drop les triggers et fonctions
    try {
      await client.query('DROP TRIGGER IF EXISTS trg_tenant_settings_updated ON tenant_settings CASCADE');
      await client.query('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');
      console.log('  OK Suppression triggers/fonctions\n');
    } catch (e) {
      console.log('  SKIP triggers (n\'existent pas)\n');
    }
    
    // Lire et appliquer le schema complet
    console.log('[SCHEMA] Application du schema multitenant complet...\n');
    
    const sqlPath = join(__dirname, 'sql', 'init_multitenant_min.sql');
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    
    console.log(`  Lecture: ${sqlPath}`);
    console.log(`  Taille: ${(sqlContent.length / 1024).toFixed(2)} KB\n`);
    
    await client.query(sqlContent);
    console.log('  OK Schema applique\n');
    
    // Verifier les tables
    console.log('[VERIFICATION] Comptage des tables...\n');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`  Total: ${result.rows.length} tables\n`);
    
    const importantTables = [
      'tenants', 'users', 'tenant_settings',
      'produits', 'stock_movements',
      'ventes', 'lignes_vente',
      'inventory_sessions', 'inventory_counts'
    ];
    
    const existingTables = result.rows.map(r => r.table_name);
    
    console.log('  Tables essentielles:');
    for (const table of importantTables) {
      const exists = existingTables.includes(table);
      console.log(`    ${exists ? 'OK' : 'KO'} ${table}`);
    }
    
    console.log('\nOK Reinitialisation terminee avec succes !');
    console.log('\nProchaines etapes:');
    console.log('  1. Creer un tenant de test');
    console.log('  2. Creer des produits de test');
    console.log('  3. Lancer les tests: npm test inventory.test.js');
    
  } catch (e) {
    console.error('\nERREUR:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

// Lancer
resetAndApplySchema()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
