// src/main/db/stock.js
const db = require('./db');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

/**
 * Calcule le stock réel d'un produit = SUM de tous les mouvements
 * Si aucun mouvement, utilise produits.stock comme fallback (compatibilité)
 */
function getStock(produitId) {
  const id = Number(produitId);

  // Base stock depuis la table produits (snap/cache)
  const baseRow = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(id);
  const baseStock = baseRow ? Number(baseRow.stock || 0) : 0;

  // Comptage des mouvements et détection d'un mouvement initial
  const stats = db.prepare(`
    SELECT COUNT(*) AS count,
           SUM(delta) AS total,
           SUM(CASE WHEN source = 'init' THEN 1 ELSE 0 END) AS init_count
    FROM stock_movements
    WHERE produit_id = ?
  `).get(id);

  const hasMovements = Number(stats?.count || 0) > 0;
  const sumMovements = Number(stats?.total || 0);
  const hasInit = Number(stats?.init_count || 0) > 0;

  if (!hasMovements) {
    // Aucun mouvement → on retourne le stock de base (compat ancien)
    return baseStock;
  }

  // S'il existe un mouvement d'init, la somme représente déjà le stock réel
  if (hasInit) {
    return sumMovements;
  }

  // Pas de mouvement d'init → on prend le stock de base + les deltas enregistrés
  return baseStock + sumMovements;
}

/**
 * Crée un mouvement de stock et envoie une opération pour la sync
 * @param {number} produitId - ID du produit
 * @param {number} delta - Variation du stock (+/-) 
 * @param {string} source - Type de mouvement: 'vente' | 'reception' | 'inventory' | 'adjust' | 'initial'
 * @param {string} sourceId - ID de la source (vente_id, reception_id, etc.)
 * @param {object} meta - Métadonnées optionnelles
 */
function createStockMovement(produitId, delta, source, sourceId = null, meta = null) {
  const id = Number(produitId);
  const d = Number(delta);
  
  // ⚠️ Autoriser delta = 0 pour le mouvement initial (important pour le calcul du stock)
  if (!Number.isFinite(d)) return;
  
  // Ne rien faire si delta = 0 ET source != 'init' (pour éviter les mouvements inutiles)
  if (d === 0 && source !== 'init') return;
  
  // Insérer le mouvement local (même si delta = 0 pour l'init)
  db.prepare(`
    INSERT INTO stock_movements (produit_id, delta, source, source_id, meta, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(id, d, source, sourceId, meta ? JSON.stringify(meta) : null);
  
  // Mettre à jour produits.stock pour compatibilité UI
  const newStock = getStock(id);
  db.prepare(`UPDATE produits SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(newStock, id);
  
  // console.log(`[stock] Mouvement créé: produit=${id}, delta=${d}, source=${source}, nouveau stock=${newStock}`);
}

/**
 * Met à jour le stock en mode absolu (nouveau système avec movements)
 * Calcule le delta et crée un mouvement d'ajustement
 */
function mettreAJourStock(produitId, newStock) {
  const id = Number(produitId);
  const current = getStock(id);
  const next = Number(newStock);
  if (!Number.isFinite(next)) return;

  const delta = next - current;
  if (delta === 0) return;

  const tx = db.transaction(() => {
    // Créer le mouvement local
    createStockMovement(id, delta, 'adjust', null, { reason: 'manual.set', previous: current, new: next });

    // Envoyer opération pour sync
    enqueueOp({
      deviceId: DEVICE_ID,
      opType: 'inventory.adjust',
      entityType: 'produit',
      entityId: String(id),
      payload: { produitId: id, delta, reason: 'manual.set' },
    });

    // Mettre à jour updated_at du produit
    db.prepare(`UPDATE produits SET updated_at = datetime('now','localtime') WHERE id = ?`).run(id);

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
  createStockMovement,
  decrementerStock,
  incrementerStock,
  mettreAJourStock,
  getStock,
  reinitialiserStock,
  decrementStock,
  incrementStock,
};
