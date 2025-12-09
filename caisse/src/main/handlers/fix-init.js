// Fix des mouvements init manquants via IPC handler
const { ipcMain } = require('electron');
const db = require('../db/db');

async function fixMissingInitMovements() {
  try {
    console.log('[fix-init] Démarrage correction mouvements init...');
    
    // 1. Trouver tous les produits sans mouvement 'init'
    const produitsWithoutInit = db.prepare(`
      SELECT p.id, p.nom, p.reference, p.stock
      FROM produits p
      WHERE NOT EXISTS (
        SELECT 1 FROM stock_movements sm 
        WHERE sm.produit_id = p.id AND sm.source = 'init'
      )
    `).all();

    console.log(`[fix-init] Trouvé ${produitsWithoutInit.length} produits sans mouvement init`);

    if (produitsWithoutInit.length === 0) {
      return { ok: true, fixed: 0, message: 'Aucune correction nécessaire' };
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
        console.log(`  ✅ ${p.reference}: init ${p.stock}`);
      }
      
      // 3. Recalculer les stocks
      db.prepare(`
        UPDATE produits 
        SET stock = (
          SELECT COALESCE(SUM(delta), 0) 
          FROM stock_movements 
          WHERE produit_id = produits.id
        )
      `).run();
    });

    tx();

    console.log(`[fix-init] ✅ ${produitsWithoutInit.length} mouvements créés`);
    return { ok: true, fixed: produitsWithoutInit.length };
    
  } catch (e) {
    console.error('[fix-init] ❌ Erreur:', e);
    return { ok: false, error: e.message };
  }
}

function registerFixInitHandler() {
  ipcMain.handle('fix-missing-init-movements', fixMissingInitMovements);
}

module.exports = { registerFixInitHandler, fixMissingInitMovements };
