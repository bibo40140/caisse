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

/** Lecture brute disque (sans cache) */
function readConfigFromDisk() {
  if (!fs.existsSync(CONFIG_PATH)) return { modules: {}, ventes_exterieur_margin_percent: DEFAULT_MARGIN };
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const json = safeParse(raw) || {};
  // Défauts minimums
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
 *  ⚠️ Filtre systématiquement auth_token & tenant_id pour ne pas les persister.
 */
function writeConfig(partial = {}) {
  const current = readConfig();
  const next = {
    ...current,
    ...partial,
    modules: { ...(current.modules || {}), ...(partial.modules || {}) },
  };

  // ⚠️ Ne jamais enregistrer ces champs dans le fichier
  if ('auth_token' in next) delete next.auth_token;
  if ('tenant_id' in next) delete next.tenant_id;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  _cache = next;
  return _cache;
}

/** Mise à jour uniquement des modules (passe aussi par writeConfig → filtrage OK) */
function writeModules(modulesMap = {}) {
  return writeConfig({ modules: modulesMap });
}

/** Récupère la marge “ventes extérieur” (%)
 *  Tolère les deux clés: ventes_exterieur_margin_percent (nouvelle) et ventes_ext_margin_percent (ancienne)
 */
function getVentesExterieurMargin() {
  const cfg = readConfig();
  // priorité à la nouvelle clé
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

module.exports = {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  writeModules,
  getVentesExterieurMargin,
  setVentesExterieurMargin,
  resetCache,
};
