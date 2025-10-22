// src/main/handlers/inventaires.js
// 👉 Gestion complète des sessions d’inventaire (ouvrir, compter, état produit, clôturer)

const db = require('../db/db');
const crypto = require('crypto');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// ————————————————————————————————————————————————
// Utils
// ————————————————————————————————————————————————
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
      );
}

function enqueueOp({ op_type, entity_type = null, entity_id = null, payload = {} }) {
  const id = uuid();
  db.prepare(`
    INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, ack)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    DEVICE_ID || 'unknown-device',
    op_type,
    entity_type,
    entity_id != null ? String(entity_id) : '',
    JSON.stringify(payload || {})
  );
  return id;
}

// Récupération du stock "théorique" local pour photo :
// 1) si la vue stocks_agg existe (mouvements), on l’utilise,
// 2) sinon on lit la colonne produits.stock (cache actuel).
function getLocalQtyAtOpen(produitId) {
  try {
    // teste la vue stocks_agg
    const v = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('view','table') AND name='stocks_agg'`).get();
    if (v) {
      const r = db.prepare(`SELECT qty FROM stocks_agg WHERE produit_id = ?`).get(Number(produitId));
      return Number(r?.qty || 0);
    }
  } catch {}
  // fallback : colonne stock du produit
  const r2 = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(Number(produitId));
  return Number(r2?.stock || 0);
}

// ————————————————————————————————————————————————
// Handlers
// ————————————————————————————————————————————————
function registerInventaireHandlers(ipcMain) {
  console.log('[handlers/inventaires] registering IPC handlers');

  // 1) OUVRIR une session d’inventaire
  // payload: { name?: string, opened_by?: string }
  ipcMain.handle('inventory:open', (_evt, payload = {}) => {
    const sessionId = uuid();
    const name = (payload.name || '').trim() || `Inventaire ${new Date().toLocaleDateString()}`;
    const openedBy = (payload.opened_by || '').trim() || null;

    // Création session + photo (snapshot) locale
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO inventory_sessions (id, name, status, opened_by)
        VALUES (?, ?, 'open', ?)
      `).run(sessionId, name, openedBy);

      // Photo des stocks à l’instant T (pour TOUS les produits existants)
      const produits = db.prepare(`SELECT id FROM produits`).all();
      const insSnap = db.prepare(`
        INSERT INTO inventory_snapshots (session_id, produit_id, qty_at_open)
        VALUES (?, ?, ?)
      `);
      for (const p of produits) {
        const qty = getLocalQtyAtOpen(p.id);
        insSnap.run(sessionId, p.id, qty);
      }
    });
    tx();

    // Op de synchro → le serveur créera SA session + SA photo (vérité serveur)
    enqueueOp({
      op_type: 'inventory.open',
      entity_type: 'inventory_session',
      entity_id: sessionId,
      payload: {
        session_id: sessionId,
        name,
        opened_by: openedBy,
        device_id: DEVICE_ID || 'unknown-device',
        // On peut envoyer un résumé local (optionnel) ; le serveur prendra sa propre photo.
        snapshot_hint: 'client_snapshot_taken'
      }
    });

    return { ok: true, session_id: sessionId, name, opened_by: openedBy };
  });

  // 2) COMPTER un produit (UPsert)
  // payload: { session_id: string, produit_id: number, counted_qty: number, counted_by?: string }
  ipcMain.handle('inventory:count', (_evt, payload = {}) => {
    const sessionId  = String(payload.session_id || '').trim();
    const produitId  = Number(payload.produit_id);
    const countedQty = Number(payload.counted_qty);
    const countedBy  = (payload.counted_by || '').trim() || null;

    if (!sessionId) throw new Error('session_id requis');
    if (!Number.isFinite(produitId) || produitId <= 0) throw new Error('produit_id invalide');
    if (!Number.isFinite(countedQty) || countedQty < 0) throw new Error('counted_qty invalide');

    // Vérifie que la session est bien ouverte
    const s = db.prepare(`SELECT status FROM inventory_sessions WHERE id = ?`).get(sessionId);
    if (!s) throw new Error('session introuvable');
    if (s.status !== 'open') throw new Error('session déjà close');

    // Upsert
    db.prepare(`
      INSERT INTO inventory_counts (session_id, produit_id, counted_qty, counted_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, produit_id)
      DO UPDATE SET counted_qty = excluded.counted_qty,
                    counted_by  = excluded.counted_by,
                    counted_at  = datetime('now','localtime')
    `).run(sessionId, produitId, countedQty, countedBy);

    // Op de synchro
    enqueueOp({
      op_type: 'inventory.count',
      entity_type: 'inventory_session',
      entity_id: sessionId,
      payload: {
        session_id: sessionId,
        produit_id: produitId,
        counted_qty: countedQty,
        counted_by: countedBy,
        device_id: DEVICE_ID || 'unknown-device'
      }
    });

    // Retourne l'état du produit après saisie (pratique pour l’UI)
    const snap = db.prepare(`
      SELECT qty_at_open FROM inventory_snapshots WHERE session_id = ? AND produit_id = ?
    `).get(sessionId, produitId);
    const photo = Number(snap?.qty_at_open ?? 0);

    return { ok: true, session_id: sessionId, produit_id: produitId, photo_qty: photo, counted_qty: countedQty };
  });

  // 3) ÉTAT d’un produit pour la session (théorique & déjà inventorié)
  // args: (session_id: string, produit_id: number)
  ipcMain.handle('inventory:get-product-state', (_evt, sessionId, produitId) => {
    const snap = db.prepare(`
      SELECT qty_at_open FROM inventory_snapshots WHERE session_id = ? AND produit_id = ?
    `).get(String(sessionId || ''), Number(produitId));
    const count = db.prepare(`
      SELECT counted_qty FROM inventory_counts WHERE session_id = ? AND produit_id = ?
    `).get(String(sessionId || ''), Number(produitId));

    return {
      session_id: String(sessionId || ''),
      produit_id: Number(produitId),
      theoretical_qty: Number(snap?.qty_at_open ?? 0),   // photo à l'ouverture
      counted_qty: Number(count?.counted_qty ?? 0)       // dernière valeur inventoriée
    };
  });

  // 4) CLÔTURER la session
  // payload: { session_id: string, closed_by?: string }
  ipcMain.handle('inventory:close', (_evt, payload = {}) => {
    const sessionId = String(payload.session_id || '').trim();
    const closedBy  = (payload.closed_by || '').trim() || null;
    if (!sessionId) throw new Error('session_id requis');

    // Passe la session en 'closed' localement
    db.prepare(`
      UPDATE inventory_sessions
      SET status = 'closed', closed_at = datetime('now','localtime')
      WHERE id = ? AND status = 'open'
    `).run(sessionId);

    // Op de synchro : le serveur calculera les deltas (counted - snapshot)
    enqueueOp({
      op_type: 'inventory.close',
      entity_type: 'inventory_session',
      entity_id: sessionId,
      payload: {
        session_id: sessionId,
        closed_by: closedBy,
        device_id: DEVICE_ID || 'unknown-device'
      }
    });

    return { ok: true, session_id: sessionId, status: 'closed' };
  });

  // (Optionnel) Liste des sessions
  ipcMain.handle('inventory:list-sessions', () => {
    return db.prepare(`
      SELECT id, name, status, opened_at, opened_by, closed_at
      FROM inventory_sessions
      ORDER BY opened_at DESC
    `).all();
  });

  // (Optionnel) Récap rapide d’une session (nb produits, nb comptés)
  ipcMain.handle('inventory:summary', (_evt, sessionId) => {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM inventory_snapshots WHERE session_id = ?`).get(String(sessionId || ''))?.n || 0;
    const counted = db.prepare(`SELECT COUNT(*) AS n FROM inventory_counts WHERE session_id = ?`).get(String(sessionId || ''))?.n || 0;
    return { session_id: String(sessionId || ''), total_products: total, counted_products: counted };
  });
}

module.exports = { registerInventaireHandlers };
