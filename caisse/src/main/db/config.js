// src/main/db/config.js
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../../../config.json'); 
// __dirname = src/main/db → ../../../ = racine du projet
const DEFAULT_MARGIN = 30;

/** Lecture sûre du JSON de config */
function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // Fallback minimal si le fichier est manquant/corrompu
    console.error('[config] readConfig fallback:', err?.message);
    return { modules: {}, ventes_exterieur_margin_percent: DEFAULT_MARGIN };
  }
}

/** Écriture (merge superficiel + merge profond pour "modules") */
function writeConfig(partial) {
  const current = readConfig();
  const next = {
    ...current,
    ...partial,
    // merge profond pour "modules"
    modules: { ...(current.modules || {}), ...(partial.modules || {}) },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Mise à jour des modules uniquement */
function writeModules(modulesMap) {
  return writeConfig({ modules: modulesMap });
}

/** Lecture du taux de marge ventes extérieur (pour usage côté main/db) */
function getVentesExterieurMargin() {
  const cfg = readConfig();
  const raw = Number(cfg.ventes_exterieur_margin_percent);
  return Number.isFinite(raw) ? raw : DEFAULT_MARGIN;
}

/** Écriture du taux de marge (valeur en %) avec validation/clamp 0–100 */
function setVentesExterieurMargin(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('Le taux de marge doit être un nombre.');
  }
  const clamped = Math.max(0, Math.min(100, num));
  return writeConfig({ ventes_exterieur_margin_percent: clamped });
}

module.exports = {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  writeModules,
  getVentesExterieurMargin,
  setVentesExterieurMargin,
};
