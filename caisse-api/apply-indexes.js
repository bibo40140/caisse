/**
 * ============================================================
 * SCRIPT D'OPTIMISATION DES INDEX POSTGRESQL
 * ============================================================
 * 
 * Applique les index pour améliorer les performances
 * À exécuter une seule fois sur la base de données de production
 */

import 'dotenv/config';
import { pool } from './db/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyIndexes() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 APPLICATION DES INDEX D\'OPTIMISATION');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const sqlFile = path.join(__dirname, 'sql', 'optimize_indexes.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  const client = await pool.connect();
  
  try {
    console.log('🔧 Application des index...\n');
    
    // Séparer par commande (chaque CREATE INDEX)
    const commands = sql
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));
    
    let created = 0;
    let skipped = 0;
    
    for (const command of commands) {
      if (!command.includes('CREATE INDEX')) continue;
      
      // Extraire le nom de l'index
      const match = command.match(/CREATE INDEX (?:IF NOT EXISTS )?(\w+)/);
      const indexName = match ? match[1] : 'unknown';
      
      try {
        await client.query(command);
        console.log(`  ✅ ${indexName}`);
        created++;
      } catch (e) {
        if (e.message.includes('already exists')) {
          console.log(`  ⏭️  ${indexName} (existe déjà)`);
          skipped++;
        } else {
          console.error(`  ❌ ${indexName}: ${e.message}`);
        }
      }
    }
    
    console.log(`\n📊 Résumé:`);
    console.log(`  - Créés: ${created}`);
    console.log(`  - Déjà présents: ${skipped}`);
    console.log(`  - Total: ${created + skipped}`);
    
    // Analyser les tables pour mettre à jour les statistiques
    console.log('\n🔍 Analyse des tables pour optimiser le query planner...\n');
    
    const tables = [
      'ventes',
      'receptions',
      'produits',
      'stock_movements',
      'lignes_vente',
      'lignes_reception',
      'categories',
      'fournisseurs',
      'adherents',
    ];
    
    for (const table of tables) {
      try {
        await client.query(`ANALYZE ${table}`);
        console.log(`  ✅ ANALYZE ${table}`);
      } catch (e) {
        console.log(`  ⏭️  ${table} (n'existe pas ou erreur)`);
      }
    }
    
    console.log('\n✨ Optimisation terminée avec succès!\n');
    console.log('═══════════════════════════════════════════════════════\n');
    
  } catch (e) {
    console.error('\n❌ Erreur:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Exécuter
applyIndexes().catch(console.error);
