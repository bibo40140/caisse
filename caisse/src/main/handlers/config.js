// src/main/handlers/config.js
const { ipcMain, BrowserWindow } = require('electron');
const { readConfig, writeConfig } = require('../db/config');

// ✅ Clés autorisées (étendues pour ne plus couper des modules à l'init)
const ALLOWED_MODULE_KEYS = [
  'adherents',
  'cotisations',
  'email',
  'emails',
  'stocks',
  'fournisseurs',
  'imports',
  'inventaire',
  'modes_paiement',
  'ventes_exterieur',
  'prospects',
  'receptions',
  'multiusers',
  'exports'
];

function broadcastConfig(cfg) {
  try {
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('config:changed', cfg); } catch {}
    });
  } catch (e) {
    console.error('[config] broadcastConfig failed:', e?.message || e);
  }
}

// mêmes règles que modules.js pour éviter les divergences
function normalizeModules(current = {}, incoming = {}) {
  const next = { ...current, ...incoming };

  // défauts
  if (typeof next.ventes_exterieur !== 'boolean') next.ventes_exterieur = false;

  // emails ⇆ email
  if (typeof next.emails === 'boolean' && typeof next.email !== 'boolean') next.email = next.emails;
  if (typeof next.email  === 'boolean' && typeof next.emails !== 'boolean') next.emails = next.email;

  // dépendances
  if (!next.adherents) {
    next.cotisations = false;
    next.prospects   = false;
  }
  if (!next.fournisseurs) {
    next.receptions = false;
  }
  // UI réceptions pilotée par stocks (règle projet)
  next.receptions = !!next.stocks;

  return next;
}

module.exports = function registerConfigHandlers(ipcMainInstance = ipcMain) {
  // ménage (reload dev)
  try { ipcMainInstance.removeHandler('config:get'); } catch {}
  try { ipcMainInstance.removeHandler('config:update-modules'); } catch {}
  try { ipcMainInstance.removeHandler('config:get-ventes-margin'); } catch {}
  try { ipcMainInstance.removeHandler('config:set-ventes-margin'); } catch {}

  // Lire toute la config
  ipcMainInstance.handle('config:get', async () => {
    return readConfig();
  });

  // Mettre à jour les modules (sanitise + normalise + deps + broadcast)
  ipcMainInstance.handle('config:update-modules', async (_e, modules) => {
    if (!modules || typeof modules !== 'object') {
      throw new Error('Modules invalides');
    }
    // garder uniquement les clés autorisées + valider booléens
    const sanitized = {};
    for (const [k, v] of Object.entries(modules)) {
      if (!ALLOWED_MODULE_KEYS.includes(k)) continue;
      if (typeof v !== 'boolean') {
        throw new Error(`Le module "${k}" doit être un booléen`);
      }
      sanitized[k] = v;
    }

    const cfg = readConfig();
    const current = cfg.modules || {};
    const normalized = normalizeModules(current, sanitized);

    const saved = writeConfig({ modules: normalized }); // merge profond via db/config.js
    broadcastConfig(saved);

    return { status: 'ok', config: saved };
  });

  // Lire la marge ventes extérieures
  ipcMainInstance.handle('config:get-ventes-margin', async () => {
    const cfg = readConfig();
    let percent = Number(cfg.ventes_ext_margin_percent);
    if (!Number.isFinite(percent) || percent < 0) percent = 30;
    return { percent };
  });

  // Écrire la marge ventes extérieures
  ipcMainInstance.handle('config:set-ventes-margin', async (_e, percent) => {
    let p = Number(percent);
    if (!Number.isFinite(p) || p < 0) throw new Error('Pourcentage invalide');
    if (p > 1000) p = 1000; // garde-fou
    const updated = writeConfig({ ventes_ext_margin_percent: p });
    broadcastConfig(updated);
    return { status: 'ok', percent: updated.ventes_ext_margin_percent };
  });
};
