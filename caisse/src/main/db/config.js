// src/main/db/config.js
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../../../config.json'); // racine projet
const DEFAULT_MARGIN = 30;

let _cache = null;

/** Parse JSON en sécurité */
function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Écrit le JSON sur disque (helper interne) */
function _write(json) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(json, null, 2), 'utf8');
}

/** Lecture brute disque (sans cache) — NE PAS purger les secrets ici */
function readConfigFromDisk() {
  let json = { modules: {}, ventes_exterieur_margin_percent: DEFAULT_MARGIN };

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    json = { ...json, ...(safeParse(raw) || {}) };
  }

  if (!json.modules) json.modules = {};
  return json;
}

/** Lecture (avec cache) — ne pas muter l’objet retourné */
function readConfig() {
  if (_cache) return _cache;
  _cache = readConfigFromDisk();
  return _cache;
}

/** Écriture générique (merge superficiel + merge profond pour "modules")
 *  ⚠️ NE PAS filtrer auth_token / tenant_id (laisse src/main/config.js gérer ça si besoin).
 */
function writeConfig(partial = {}) {
  const current = readConfig();
  const next = {
    ...current,
    ...partial,
    modules: { ...(current.modules || {}), ...(partial.modules || {}) },
  };

  _write(next);
  _cache = next;
  return _cache;
}

/** Mise à jour uniquement des modules */
function writeModules(modulesMap = {}) {
  return writeConfig({ modules: modulesMap });
}

/** Récupère la marge “ventes extérieur” (%) */
function getVentesExterieurMargin() {
  const cfg = readConfig();
  let raw = cfg.ventes_exterieur_margin_percent;
  if (raw === undefined) raw = cfg.ventes_ext_margin_percent; // rétro-compat
  const num = Number(raw);
  return Number.isFinite(num) ? num : DEFAULT_MARGIN;
}

/** Écrit la marge “ventes extérieur” (%) avec clamp 0–100 */
function setVentesExterieurMargin(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error('Le taux de marge doit être un nombre.');
  const clamped = Math.max(0, Math.min(100, num));
  return writeConfig({ ventes_exterieur_margin_percent: clamped });
}

/** (Optionnel) Reset du cache en mémoire — utile au logout */
function resetCache() {
  _cache = null;
}

/** 🔧 utilitaires : suppression explicite des secrets + réécriture disque (utilisé au logout si tu veux) */
function removeAuthToken() {
  const cfg = readConfig();
  const had = 'auth_token' in cfg;
  if (had) delete cfg.auth_token;
  _write(cfg);
  _cache = cfg;
  return had;
}
function removeTenantId() {
  const cfg = readConfig();
  const had = 'tenant_id' in cfg;
  if (had) delete cfg.tenant_id;
  _write(cfg);
  _cache = cfg;
  return had;
}

/** NO-OP désormais : on ne purge plus automatiquement au démarrage */
function scrubSecrets() {
  return false;
}

module.exports = {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  writeModules,
  getVentesExterieurMargin,
  setVentesExterieurMargin,
  resetCache,
  removeAuthToken,
  removeTenantId,
  scrubSecrets,
};
