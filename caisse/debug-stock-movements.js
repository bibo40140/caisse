// debug-stock-movements.js
// Affiche tous les mouvements de stock pour un produit
const { app } = require('electron');
const Database = require('better-sqlite3');

if (!app.isReady()) {
  app.whenReady().then(() => {
    runDebug();
    app.quit();
  });
} else {
  runDebug();
  app.quit();
}

function runDebug() {
  const dbPath = process.argv[process.argv.length - 1];
  if (!dbPath || dbPath.includes('debug-stock')) {
    console.error('Usage: electron debug-stock-movements.js <chemin/vers/tenant.db>');
    return;
  }

  const db = new Database(dbPath, { readonly: true });

  console.log('\n=== MOUVEMENTS DE STOCK ===\n');

  const movements = db.prepare(`
    SELECT 
      sm.id,
      sm.produit_id,
      p.nom as produit_nom,
      sm.delta,
      sm.source,
      sm.source_id,
      sm.created_at,
      sm.remote_uuid
    FROM stock_movements sm
    LEFT JOIN produits p ON sm.produit_id = p.id
    ORDER BY sm.created_at DESC
    LIMIT 50
  `).all();

  if (movements.length === 0) {
    console.log('✅ Aucun mouvement de stock');
  } else {
    console.log(`📊 ${movements.length} mouvement(s) de stock:\n`);
    
    movements.forEach((m, i) => {
      console.log(`${i + 1}. [${m.source}] ${m.produit_nom || 'Produit #' + m.produit_id}`);
      console.log(`   Delta: ${m.delta > 0 ? '+' : ''}${m.delta}`);
      console.log(`   Source ID: ${m.source_id || 'N/A'}`);
      console.log(`   Date: ${m.created_at}`);
      console.log(`   Remote UUID: ${m.remote_uuid || 'LOCAL'}`);
      console.log('');
    });

    // Récapitulatif par produit
    console.log('\n=== STOCK PAR PRODUIT ===\n');
    const stockByProduct = db.prepare(`
      SELECT 
        p.id,
        p.nom,
        p.stock as stock_actuel,
        COALESCE(SUM(sm.delta), 0) as stock_calcule
      FROM produits p
      LEFT JOIN stock_movements sm ON sm.produit_id = p.id
      GROUP BY p.id
      HAVING stock_calcule != 0 OR stock_actuel != 0
      ORDER BY p.nom
    `).all();

    stockByProduct.forEach(s => {
      const diff = s.stock_actuel - s.stock_calcule;
      const status = diff === 0 ? '✅' : '❌';
      console.log(`${status} ${s.nom}`);
      console.log(`   Stock actuel: ${s.stock_actuel}`);
      console.log(`   Stock calculé: ${s.stock_calcule}`);
      if (diff !== 0) {
        console.log(`   ⚠️  DIFFÉRENCE: ${diff}`);
      }
      console.log('');
    });
  }

  db.close();
}
