// clean-duplicate-movements.js
// Supprime les mouvements de stock en double (même remote_uuid)
const { app } = require('electron');
const Database = require('better-sqlite3');

if (!app.isReady()) {
  app.whenReady().then(() => {
    runClean();
    app.quit();
  });
} else {
  runClean();
  app.quit();
}

function runClean() {
  const dbPath = process.argv[process.argv.length - 1];
  if (!dbPath || dbPath.includes('clean-duplicate')) {
    console.error('Usage: electron clean-duplicate-movements.js <chemin/vers/tenant.db>');
    return;
  }

  const db = new Database(dbPath);

  console.log('\n=== NETTOYAGE DES MOUVEMENTS EN DOUBLE ===\n');

  try {
    // Trouver les doublons
    const duplicates = db.prepare(`
      SELECT remote_uuid, COUNT(*) as count
      FROM stock_movements
      WHERE remote_uuid IS NOT NULL
      GROUP BY remote_uuid
      HAVING count > 1
    `).all();

    console.log(`📊 ${duplicates.length} remote_uuid en double trouvé(s)`);

    if (duplicates.length === 0) {
      console.log('✅ Aucun doublon à nettoyer');
      db.close();
      return;
    }

    // Pour chaque doublon, garder le premier et supprimer les autres
    let totalDeleted = 0;
    for (const dup of duplicates) {
      const movements = db.prepare(`
        SELECT id FROM stock_movements 
        WHERE remote_uuid = ? 
        ORDER BY id ASC
      `).all(dup.remote_uuid);

      // Garder le premier, supprimer les autres
      const toDelete = movements.slice(1);
      for (const m of toDelete) {
        db.prepare('DELETE FROM stock_movements WHERE id = ?').run(m.id);
        totalDeleted++;
      }
      
      console.log(`  Nettoyé ${toDelete.length} doublon(s) pour remote_uuid ${dup.remote_uuid}`);
    }

    console.log(`\n✅ ${totalDeleted} mouvement(s) en double supprimé(s)`);

    // Recalculer les stocks
    console.log('\n📊 Recalcul des stocks...');
    const produits = db.prepare('SELECT id FROM produits').all();
    const getStockFromMovements = db.prepare(`
      SELECT COALESCE(SUM(delta), 0) AS total 
      FROM stock_movements 
      WHERE produit_id = ?
    `);
    const updateStock = db.prepare('UPDATE produits SET stock = ? WHERE id = ?');
    
    let recalculated = 0;
    for (const p of produits) {
      const result = getStockFromMovements.get(p.id);
      const calculatedStock = Number(result?.total || 0);
      updateStock.run(calculatedStock, p.id);
      recalculated++;
    }
    
    console.log(`✅ ${recalculated} stock(s) recalculé(s)`);

  } catch (e) {
    console.error('❌ Erreur:', e.message);
  } finally {
    db.close();
  }
}
