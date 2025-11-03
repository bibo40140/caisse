// src/main/handlers/config.js
'use strict';

const { ipcMain, BrowserWindow } = require('electron');

// ⚠️ IMPORTANT : on unifie la source de vérité de la config ici.
// On lit/écrit via src/main/config.js (getConfig / setConfig)
// afin que 'config:get' expose bien api_base_url au renderer.
const { getConfig, setConfig } = require('../config');

// ✅ Clés autorisées (étendues pour éviter de couper des modules à l'init)
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

// ⚙️ Normalisation identique à handlers/modules.js (pour éviter les divergences)
function normalizeModules(current = {}, incoming = {}) {
  const next = { ...current, ...incoming };

  // Valeurs par défaut
  if (typeof next.ventes_exterieur !== 'boolean') next.ventes_exterieur = false;

  // Harmonisation email ⇄ emails
  if (typeof next.emails === 'boolean' && typeof next.email !== 'boolean') next.email = next.emails;
  if (typeof next.email  === 'boolean' && typeof next.emails !== 'boolean') next.emails = next.email;

  // Dépendances métier
  if (!next.adherents) {
    next.cotisations = false;
    next.prospects   = false;
    next.emails      = false;
    next.email       = false;
  }
  if (!next.fournisseurs) {
    next.receptions = false;
  }

  // Règle projet : réceptions suit stocks
  next.receptions = !!next.stocks;

  return next;
}

module.exports = function registerConfigHandlers(ipcMainInstance = ipcMain) {
  // Ménage (utile en reload dev)
  try { ipcMainInstance.removeHandler('config:get'); } catch {}
  try { ipcMainInstance.removeHandler('config:update-modules'); } catch {}
  try { ipcMainInstance.removeHandler('config:get-ventes-margin'); } catch {}
  try { ipcMainInstance.removeHandler('config:set-ventes-margin'); } catch {}

  // Lire toute la config (expose api_base_url depuis src/main/config.js)
  ipcMainInstance.handle('config:get', async () => {
    return getConfig();
  });

  // Mettre à jour les modules (sanitize + normalize + deps + broadcast)
  ipcMainInstance.handle('config:update-modules', async (_e, modules) => {
    if (!modules || typeof modules !== 'object') {
      throw new Error('Modules invalides');
    }

    // Garder uniquement les clés autorisées et s’assurer que ce sont des booléens
    const sanitized = {};
    for (const [k, v] of Object.entries(modules)) {
      if (!ALLOWED_MODULE_KEYS.includes(k)) continue;
      if (typeof v !== 'boolean') {
        throw new Error(`Le module "${k}" doit être un booléen`);
      }
      sanitized[k] = v;
    }

    const cfg = getConfig();
    const current = cfg.modules || {};
    const normalized = normalizeModules(current, sanitized);

    // On écrit via setConfig pour rester sur le même fichier que getConfig()
    const saved = setConfig({ ...cfg, modules: normalized });

    broadcastConfig(saved);
    return { status: 'ok', config: saved };
  });

  // Lire la marge ventes extérieures (compat nouvelle/ancienne clé)
  ipcMainInstance.handle('config:get-ventes-margin', async () => {
    const cfg = getConfig();
    let percent = Number(
      cfg.ventes_exterieur_margin_percent !== undefined
        ? cfg.ventes_exterieur_margin_percent
        : cfg.ventes_ext_margin_percent // rétro-compat
    );
    if (!Number.isFinite(percent) || percent < 0) percent = 30;
    return { percent };
  });

  // Écrire la marge ventes extérieures
  ipcMainInstance.handle('config:set-ventes-margin', async (_e, percent) => {
    let p = Number(percent);
    if (!Number.isFinite(p) || p < 0) throw new Error('Pourcentage invalide');
    if (p > 1000) p = 1000; // garde-fou

    const cfg = getConfig();
    const updated = setConfig({ ...cfg, ventes_exterieur_margin_percent: p });

    broadcastConfig(updated);
    return { status: 'ok', percent: updated.ventes_exterieur_margin_percent };
  });
};
