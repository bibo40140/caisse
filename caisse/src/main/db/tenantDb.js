// src/main/db/tenantDb.js
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const applySchemaAndSeeds = require('./schema');

const CACHE = new Map(); // key = tenantId|null → { db, inited: true }

function getActiveTenantId() {
  const tok = process.env.API_AUTH_TOKEN || null;
  if (!tok) return null;
  try {
    const p = jwt.decode(tok) || {};
    return p.tenant_id ?? null;
  } catch {
    return null;
  }
}

function dbPathFor(tenantId) {
  const suffix = tenantId ? String(tenantId) : 'default';
  return path.resolve(__dirname, `../../../coopaz.${suffix}.db`);
}

function getTenantDb(explicitTenantId = null) {
  const id = explicitTenantId ?? getActiveTenantId();
  const key = id || 'default';
  const cached = CACHE.get(key);
  if (cached) return cached.db;

  const file = dbPathFor(id);
  const db = new Database(file);
  db.pragma('foreign_keys = ON');

  const hasMeta = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'"
  ).get();
  if (!hasMeta) {
    applySchemaAndSeeds(db); // crée tables + seeds pour ce tenant
  }
  CACHE.set(key, { db, inited: true });
  return db;
}

function resetCache() {
  for (const v of CACHE.values()) { try { v.db.close(); } catch {} }
  CACHE.clear();
}

module.exports = { getTenantDb, getActiveTenantId, resetCache };
