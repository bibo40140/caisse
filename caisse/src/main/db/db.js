// src/main/db/db.js
const { getTenantDb, getActiveTenantId } = require('./tenantDb');

// On mémorise quels tenants ont déjà été initialisés pour éviter de recréer le schéma à chaque accès
const INIT_DONE = new Set();

/** Initialise le schéma minimal par tenant (idempotent) */
function initSchemaIfNeeded(db, tenantKey) {
  if (INIT_DONE.has(tenantKey)) return;

  // Sécurités/performances
  try { db.pragma('foreign_keys = ON'); } catch (_) {}
  try { db.pragma('journal_mode = WAL'); } catch (_) {}

  // Table de paramètres clé/valeur pour le tenant (utilisée pour SMTP, etc.)
  // value_json stocke un objet arbitraire (stringifié), ex:
  //   email.provider, email.host, email.port, email.user, email.pass, email.from, email.secure, ...
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT,
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_settings_key ON tenant_settings(key);
  `);

  INIT_DONE.add(tenantKey);
}

/** Récupère la DB pour le tenant actif et garantit l'init du schéma */
function getDbEnsured() {
  const tenantId = getActiveTenantId() || 'default';
  const db = getTenantDb(tenantId);
  initSchemaIfNeeded(db, String(tenantId));
  return db;
}

/**
 * Proxy qui renvoie les méthodes/propriétés de better-sqlite3
 * mais toujours reliées à la DB du tenant actif.
 */
const proxy = new Proxy({}, {
  get(_t, prop) {
    const db = getDbEnsured();
    const v = db[prop];
    return typeof v === 'function' ? v.bind(db) : v;
  }
});

module.exports = proxy;
