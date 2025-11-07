// src/main/db/tenantDb.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ensureLocalSchema } = require('./schema');

let ACTIVE_TENANT_ID = null;
const DBS = new Map();

function setActiveTenantId(id) {
  ACTIVE_TENANT_ID = id || 'default';
}

function getActiveTenantId() {
  return ACTIVE_TENANT_ID || 'default';
}

function getTenantDb(tenantId) {
  const id = tenantId || getActiveTenantId() || 'default';
  if (DBS.has(id)) return DBS.get(id);

  // store DB files in a local /db folder
  const dir = path.join(process.cwd(), 'db');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  const file = path.join(dir, `tenant_${id}.db`);
  const db = new Database(file);

  try { db.pragma('foreign_keys = ON'); } catch {}
  try { db.pragma('journal_mode = WAL'); } catch {}

  // 👇 canonical local schema
  ensureLocalSchema(db);

  DBS.set(id, db);
  return db;
}

module.exports = { getTenantDb, getActiveTenantId, setActiveTenantId };
