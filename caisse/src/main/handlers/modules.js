// src/main/handlers/modules.js
const { ipcMain, BrowserWindow } = require('electron');
const { readConfig, writeConfig } = require('../db/config');

// Normalisation/dépendances cohérentes avec le reste du projet
function normalizeModules(current = {}, incoming = {}) {
  const next = { ...current, ...incoming };

  // emails ⇄ email
  if (typeof next.emails === 'boolean' && typeof next.email !== 'boolean') next.email = next.emails;
  if (typeof next.email  === 'boolean' && typeof next.emails !== 'boolean') next.emails = next.email;

  // défauts
  if (typeof next.ventes_exterieur !== 'boolean') next.ventes_exterieur = false;

  // dépendances métier
  if (!next.adherents) {
    next.cotisations = false;
    next.prospects   = false;
    next.emails      = false;
    next.email       = false;
  }
  if (!next.fournisseurs) {
    next.receptions = false;
  }
  // règle UI: réceptions suit stocks
  next.receptions = !!next.stocks;

  return next;
}

function broadcastConfig(cfg) {
  try {
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('config:changed', cfg); } catch {}
    });
  } catch (e) {
    console.error('[modules] broadcast failed:', e?.message || e);
  }
}

function registerModulesHandlers() {
  // ménage (utile en reload dev)
  try { ipcMain.removeHandler('get-modules'); } catch {}
  try { ipcMain.removeHandler('set-modules'); } catch {}
  try { ipcMain.removeHandler('modules:save'); } catch {}

  // Lire l’état courant des modules (depuis config.json)
  ipcMain.handle('get-modules', () => {
    const cfg = readConfig();
    return cfg.modules || {};
  });

  // Alias historique utilisé par certains écrans
  ipcMain.handle('modules:save', (_e, modulesMap = {}) => {
    const cfg = readConfig();
    const current = cfg.modules || {};
    // ne garder que des booléens
    const sanitized = {};
    for (const [k, v] of Object.entries(modulesMap || {})) {
      if (typeof v === 'boolean') sanitized[k] = v;
    }
    const normalized = normalizeModules(current, sanitized);
    const saved = writeConfig({ modules: normalized }); // merge profond côté db/config
    broadcastConfig(saved);
    return { ok: true, modules: saved.modules || {} };
  });

  // Setter principal (même logique que modules:save)
  ipcMain.handle('set-modules', (_e, newModules) => {
    if (!newModules || typeof newModules !== 'object') {
      throw new Error('Modules invalides');
    }
    const cfg = readConfig();
    const current = cfg.modules || {};
    const sanitized = {};
    for (const [k, v] of Object.entries(newModules)) {
      if (typeof v === 'boolean') sanitized[k] = v;
    }
    const normalized = normalizeModules(current, sanitized);
    const saved = writeConfig({ modules: normalized });
    broadcastConfig(saved);
    return { ok: true, modules: saved.modules || {} };
  });
}

module.exports = registerModulesHandlers;
