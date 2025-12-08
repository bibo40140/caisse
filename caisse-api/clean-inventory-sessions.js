// Script pour supprimer toutes les sessions d'inventaire et leurs données associées
import { pool } from './db/index.js';

async function cleanInventory() {
  console.log('🗑️  Nettoyage des sessions d\'inventaire...');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Compter les sessions avant suppression
    const countBefore = await client.query('SELECT COUNT(*) FROM inventory_sessions');
    console.log(`📊 Sessions trouvées: ${countBefore.rows[0].count}`);
    
    // Supprimer toutes les données d'inventaire (CASCADE supprimera les tables liées)
    await client.query('DELETE FROM inventory_sessions');
    
    console.log('✅ Toutes les sessions d\'inventaire ont été supprimées');
    console.log('   - inventory_sessions: vidée');
    console.log('   - inventory_counts: vidée (CASCADE)');
    console.log('   - inventory_snapshot: vidée (CASCADE)');
    console.log('   - inventory_adjust: vidée (CASCADE)');
    
    await client.query('COMMIT');
    console.log('\n✅ Nettoyage terminé ! Vous pouvez créer de nouvelles sessions.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanInventory().catch(err => {
  console.error(err);
  process.exit(1);
});
