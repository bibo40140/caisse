// Script pour créer les mouvements 'init' manquants pour les produits existants
const db = require('./src/main/db/db');

console.log('[fix-init] Utilisation de la base de données locale');

try {
  // 1. Trouver tous les produits qui n'ont PAS de mouvement 'init'
  const produitsWithoutInit = db.prepare(`
    SELECT p.id, p.nom, p.reference, p.stock
    FROM produits p
    WHERE NOT EXISTS (
      SELECT 1 FROM stock_movements sm 
      WHERE sm.produit_id = p.id AND sm.source = 'init'
    )
    AND p.stock != 0
  `).all();

  console.log(`[fix-init] Trouvé ${produitsWithoutInit.length} produits sans mouvement init`);

  if (produitsWithoutInit.length === 0) {
    console.log('[fix-init] ✅ Aucune correction nécessaire!');
    process.exit(0);
  }

  // 2. Créer les mouvements 'init' manquants
  const insertStmt = db.prepare(`
    INSERT INTO stock_movements (produit_id, delta, source, source_id, meta, created_at)
    VALUES (?, ?, 'init', NULL, ?, datetime('now','localtime'))
  `);

  const tx = db.transaction(() => {
    for (const p of produitsWithoutInit) {
      insertStmt.run(
        p.id,
        p.stock,
        JSON.stringify({ reason: 'fix.missing_init', reference: p.reference })
      );
      console.log(`  ✅ ${p.reference} (${p.nom}): mouvement init créé avec stock=${p.stock}`);
    }
  });

  tx();

  console.log(`[fix-init] ✅ ${produitsWithoutInit.length} mouvements 'init' créés avec succès!`);
  
  // 3. Vérification: recalculer les stocks
  const recalculate = db.prepare(`
    UPDATE produits 
    SET stock = (
      SELECT COALESCE(SUM(delta), 0) 
      FROM stock_movements 
      WHERE produit_id = produits.id
    )
  `);
  
  recalculate.run();
  console.log('[fix-init] ✅ Stocks recalculés');

} catch (e) {
  console.error('[fix-init] ❌ Erreur:', e.message);
  process.exit(1);
}
