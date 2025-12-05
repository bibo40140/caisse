// clean-product-ops.js
// Supprime les opérations product.created/updated obsolètes pour éviter la remise à 0 des stocks
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
  if (!dbPath || dbPath.includes('clean-product-ops')) {
    console.error('Usage: electron clean-product-ops.js <chemin/vers/tenant.db>');
    return;
  }

  const db = new Database(dbPath);

  console.log('\n=== NETTOYAGE DES OPÉRATIONS PRODUITS ===\n');

  try {
    // Compter les opérations concernées
    const countBefore = db.prepare(`
      SELECT COUNT(*) as count 
      FROM ops_queue 
      WHERE op_type IN ('product.created', 'product.updated')
    `).get();

    console.log(`📊 ${countBefore.count} opération(s) product.created/updated trouvée(s)`);

    if (countBefore.count === 0) {
      console.log('✅ Aucune opération à nettoyer');
      db.close();
      return;
    }

    // Supprimer les opérations
    const result = db.prepare(`
      DELETE FROM ops_queue 
      WHERE op_type IN ('product.created', 'product.updated')
    `).run();

    console.log(`✅ ${result.changes} opération(s) supprimée(s)`);

    // Compter ce qui reste
    const countAfter = db.prepare(`
      SELECT COUNT(*) as count FROM ops_queue
    `).get();

    console.log(`📊 ${countAfter.count} opération(s) restante(s) dans la queue`);

  } catch (e) {
    console.error('❌ Erreur:', e.message);
  } finally {
    db.close();
  }
}
