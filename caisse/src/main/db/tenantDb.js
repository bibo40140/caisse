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

  // Allow per-poste override of the DB file (handy for multiposte on same machine)
  const overrideFile = (process.env.DB_FILE || '').trim();
  let filePath;

  if (overrideFile) {
    filePath = path.isAbsolute(overrideFile)
      ? overrideFile
      : path.join(process.cwd(), overrideFile);
  } else {
    // store DB files in DATA_DIR or fallback to local /db folder
    const baseDir = process.env.DATA_DIR || path.join(process.cwd(), 'db');
    const dir = path.isAbsolute(baseDir) ? baseDir : path.join(process.cwd(), baseDir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}

    filePath = path.join(dir, `tenant_${id}.db`);
  }

  const dbKey = `${id}::${filePath}`;
  if (DBS.has(dbKey)) return DBS.get(dbKey);

  const db = new Database(filePath);

  try { db.pragma('foreign_keys = ON'); } catch {}
  try { db.pragma('journal_mode = WAL'); } catch {}

  // 👇 canonical local schema
  ensureLocalSchema(db);

  DBS.set(dbKey, db);
  return db;
}

module.exports = { getTenantDb, getActiveTenantId, setActiveTenantId };
