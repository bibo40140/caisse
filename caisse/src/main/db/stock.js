// src/main/db/stock.js
const db = require('./db');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// lecture simple
function getStock(produitId) {
  const r = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(Number(produitId));
  return r ? Number(r.stock || 0) : 0;
}

// ajustement absolu -> delta + op inventory.adjust + push
function mettreAJourStock(produitId, newStock) {
  const id = Number(produitId);
  const current = getStock(id);
  const next = Number(newStock);
  if (!Number.isFinite(next)) return;

  const delta = next - current;
  if (delta === 0) return;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE produits SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(next, id);

    enqueueOp({
      deviceId: DEVICE_ID,
      opType: 'inventory.adjust',
      entityType: 'produit',
      entityId: String(id),
      payload: { produitId: id, delta, reason: 'manual.set' },
    });

    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(()=>{});
    } catch {}
  });

  tx();
}

// helpers compat (incr/decr) -> utilisent l’absolu
function incrementerStock(produitId, quantite) {
  const cur = getStock(produitId);
  mettreAJourStock(produitId, cur + Number(quantite || 0));
}
function decrementerStock(produitId, quantite) {
  const cur = getStock(produitId);
  mettreAJourStock(produitId, cur - Number(quantite || 0));
}
function reinitialiserStock(produitId) {
  mettreAJourStock(produitId, 0);
}

const decrementStock = decrementerStock;
const incrementStock = incrementerStock;

module.exports = {
  decrementerStock,
  incrementerStock,
  mettreAJourStock,
  getStock,
  reinitialiserStock,
  decrementStock,
  incrementStock,
};
