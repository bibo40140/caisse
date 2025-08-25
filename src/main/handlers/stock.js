// src/main/handlers/stock.js
const stockDb = require('../db/stock');
let db = null;


module.exports = function registerStockHandlers(ipcMain) {
  ipcMain.handle('decrementer-stock', (event, produitId, quantite) => {
    return stockDb.decrementerStock(produitId, quantite);
  });

  ipcMain.handle('incrementer-stock', (event, produitId, quantite) => {
    return stockDb.incrementerStock(produitId, quantite);
  });

  ipcMain.handle('mettre-a-jour-stock', (event, produitId, quantite) => {
    return stockDb.mettreAJourStock(produitId, quantite);
  });

  ipcMain.handle('get-stock', (event, produitId) => {
    return stockDb.getStock(produitId);
  });

  ipcMain.handle('reinitialiser-stock', () => {
    return stockDb.reinitialiserStock();
  });
  
 ipcMain.handle('stock:adjust-bulk', async (_e, payload) => {
  const { lines = [] } = payload || {};
  if (!Array.isArray(lines) || !lines.length) return { ok: true, applied: 0 };

  const hasInc = typeof stockDb?.incrementerStock === 'function';
  const hasDec = typeof stockDb?.decrementerStock === 'function';

  // Si tu as un wrapper sqlite avec getConnection/exec/run, on l’utilise pour entourer d’une transaction (facultatif)
  const conn = db?.getConnection ? await db.getConnection() : null;
  try {
    if (conn?.exec) await conn.exec('BEGIN IMMEDIATE TRANSACTION;');

    let applied = 0;
    for (const L of lines) {
      const id = Number(L?.produit_id);
      const delta = Number(L?.delta || 0);
      if (!id || !delta) continue;

      if (delta > 0) {
        if (hasInc) {
          await stockDb.incrementerStock(id, delta);
        } else if (conn?.run) {
          await conn.run('UPDATE produits SET stock = stock + ? WHERE id = ?', [delta, id]);
        }
      } else {
        const q = Math.abs(delta);
        if (hasDec) {
          await stockDb.decrementerStock(id, q);
        } else if (conn?.run) {
          await conn.run('UPDATE produits SET stock = stock - ? WHERE id = ?', [q, id]);
        }
      }
      applied++;
    }

    if (conn?.exec) await conn.exec('COMMIT;');
    return { ok: true, applied };
  } catch (e) {
    if (conn?.exec) try { await conn.exec('ROLLBACK;'); } catch {}
    return { ok: false, error: e.message };
  } finally {
    if (db?.releaseConnection && conn) db.releaseConnection(conn);
  }
});
  

};
