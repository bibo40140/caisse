// src/main/db/db.js
const { getTenantDb, getActiveTenantId } = require('./tenantDb');

const INIT_DONE = new Set();

function initSchemaIfNeeded(db, tenantKey) {
  // getTenantDb already called ensureLocalSchema, so we only keep pragmas + guard.
  if (INIT_DONE.has(tenantKey)) return;
  try { db.pragma('foreign_keys = ON'); } catch {}
  try { db.pragma('journal_mode = WAL'); } catch {}
  try { db.pragma('busy_timeout = 5000'); } catch {} // 🔥 Attendre jusqu'à 5s si base locked
  INIT_DONE.add(tenantKey);
}

function getDbEnsured() {
  const tenantId = getActiveTenantId() || 'default';
  const db = getTenantDb(tenantId);
  initSchemaIfNeeded(db, String(tenantId));
  return db;
}

const proxy = new Proxy({}, {
  get(_t, prop) {
    const db = getDbEnsured();
    const v = db[prop];
    return typeof v === 'function' ? v.bind(db) : v;
  }
});

module.exports = proxy;
