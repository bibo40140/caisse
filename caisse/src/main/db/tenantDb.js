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

  // store DB files in DATA_DIR or fallback to local /db folder
  const baseDir = process.env.DATA_DIR || path.join(process.cwd(), 'db');
  const dir = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
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
