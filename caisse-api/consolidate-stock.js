#!/usr/bin/env node

/**
 * Job de consolidation quotidien pour la synchronisation du stock
 * 
 * Ce script doit être exécuté chaque nuit (ex: 2h du matin) via cron
 * 
 * Actions:
 * 1. Refresh current_stock depuis stock_movements
 * 2. Créer un snapshot quotidien du stock
 * 3. Nettoyer les mouvements de plus de 90 jours
 * 4. Nettoyer les snapshots de plus de 2 ans
 * 
 * Usage:
 *   node consolidate-stock.js
 * 
 * Cron (tous les jours à 2h):
 *   0 2 * * * cd /path/to/caisse-api && node consolidate-stock.js >> /var/log/stock-consolidation.log 2>&1
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false
});

async function consolidateStock() {
  console.log('='.repeat(60));
  console.log('🔄 Démarrage de la consolidation du stock');
  console.log('Date:', new Date().toISOString());
  console.log('='.repeat(60));
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Refresh current_stock
    console.log('\n📊 Étape 1: Refresh current_stock...');
    const refreshResult = await client.query('SELECT refresh_current_stock()');
    const refreshCount = refreshResult.rows[0]?.refresh_current_stock || 0;
    console.log(`✅ ${refreshCount} produits mis à jour dans current_stock`);
    
    // 2. Créer snapshot quotidien
    console.log('\n📸 Étape 2: Création du snapshot quotidien...');
    const snapshotResult = await client.query('SELECT create_daily_snapshot()');
    const snapshotCount = snapshotResult.rows[0]?.create_daily_snapshot || 0;
    console.log(`✅ ${snapshotCount} snapshots créés pour la date du jour`);
    
    // 3. Nettoyer les movements de plus de 90 jours
    console.log('\n🧹 Étape 3: Nettoyage des movements > 90 jours...');
    const cleanupMovementsResult = await client.query('SELECT cleanup_old_stock_movements(90)');
    const deletedMovements = cleanupMovementsResult.rows[0]?.cleanup_old_stock_movements || 0;
    console.log(`✅ ${deletedMovements} movements supprimés`);
    
    // 4. Nettoyer les snapshots de plus de 2 ans
    console.log('\n🧹 Étape 4: Nettoyage des snapshots > 2 ans...');
    const cleanupSnapshotsResult = await client.query('SELECT cleanup_old_snapshots(2)');
    const deletedSnapshots = cleanupSnapshotsResult.rows[0]?.cleanup_old_snapshots || 0;
    console.log(`✅ ${deletedSnapshots} snapshots supprimés`);
    
    // 5. Statistiques finales
    console.log('\n📈 Statistiques:');
    
    const statsMovements = await client.query(`
      SELECT 
        COUNT(*) as total_movements,
        COUNT(DISTINCT tenant_id) as tenants,
        COUNT(DISTINCT produit_id) as products
      FROM stock_movements
    `);
    console.log('  Movements actifs:', statsMovements.rows[0]);
    
    const statsSnapshots = await client.query(`
      SELECT 
        COUNT(*) as total_snapshots,
        COUNT(DISTINCT tenant_id) as tenants,
        COUNT(DISTINCT snapshot_date) as dates
      FROM stock_snapshots
    `);
    console.log('  Snapshots:', statsSnapshots.rows[0]);
    
    const statsCurrentStock = await client.query(`
      SELECT 
        COUNT(*) as products,
        COUNT(DISTINCT tenant_id) as tenants,
        SUM(quantity) as total_stock
      FROM current_stock
    `);
    console.log('  Stock actuel:', statsCurrentStock.rows[0]);
    
    await client.query('COMMIT');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Consolidation terminée avec succès!');
    console.log('='.repeat(60));
    
    return {
      success: true,
      refreshed: refreshCount,
      snapshots: snapshotCount,
      deleted_movements: deletedMovements,
      deleted_snapshots: deletedSnapshots
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERREUR lors de la consolidation:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Exécution
if (require.main === module) {
  consolidateStock()
    .then(result => {
      console.log('\n📊 Résultat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Erreur fatale:', error);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}

export { consolidateStock };
