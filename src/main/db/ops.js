// src/main/db/ops.js
const db = require('./db');
const { randomUUID } = require('crypto');

/**
 * Enfile une opération à pousser vers l'API (table ops_queue).
 * @param {Object} p
 *  - deviceId: string
 *  - opType: string (ex: 'sale.created', 'sale.line_added', 'reception.line_added', 'inventory.adjust', ...)
 *  - entityType?: string
 *  - entityId?: string|number
 *  - payload: object (sera JSON.stringify)
 * @returns {string} op id (uuid)
 */
function enqueueOp({ deviceId, opType, entityType = null, entityId = null, payload = {} }) {
  if (!deviceId) throw new Error('enqueueOp: deviceId manquant');
  if (!opType) throw new Error('enqueueOp: opType manquant');

  const id = randomUUID();
  db.prepare(`
    INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, created_at, ack)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), 0)
  `).run(
    id,
    String(deviceId),
    String(opType),
    entityType ? String(entityType) : null,
    entityId != null ? String(entityId) : null,
    JSON.stringify(payload || {})
  );
  return id;
}

module.exports = { enqueueOp };
