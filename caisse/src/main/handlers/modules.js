// src/main/handlers/modules.js
'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const { readConfig, writeConfig } = require('../db/config');

// --- Normalisation / règles métier cohérentes ---
function normalizeModules(current = {}, incoming = {}) {
  const next = { ...current, ...incoming };

  // Harmonisation email/emails
  if (typeof next.emails === 'boolean' && typeof next.email !== 'boolean') next.email = next.emails;
  if (typeof next.email  === 'boolean' && typeof next.emails !== 'boolean') next.emails = next.email;

  // Valeurs par défaut
  if (typeof next.ventes_exterieur !== 'boolean') next.ventes_exterieur = false;

  // Dépendances
  if (!next.adherents) {
    next.cotisations = false;
    next.prospects   = false;
    next.emails      = false;
    next.email       = false;
  }
  if (!next.fournisseurs) {
    next.receptions = false;
  }

  // Règle UI/fonctionnelle : réceptions suit l'état de stocks
  next.receptions = !!next.stocks;

  return next;
}

// --- Diffusion config -> toutes fenêtres ---
function broadcastConfig(cfg) {
  try {
    const all = BrowserWindow.getAllWindows();
    for (const w of all) {
      try { w.webContents.send('config:changed', cfg); } catch {}
    }
  } catch (e) {
    console.error('[modules] broadcast failed:', e?.message || e);
  }
}

// --- Enregistrement des handlers IPC ---
function registerModulesHandlers() {
  // Ménage (utile en reload dev)
  try { ipcMain.removeHandler('get-modules'); } catch {}
  try { ipcMain.removeHandler('modules:get'); } catch {}
  try { ipcMain.removeHandler('set-modules'); } catch {}
  try { ipcMain.removeHandler('modules:save'); } catch {}

  // GETTERS (deux alias pour compat)
  // 🔥 Ces handlers essaient d'abord de lire les modules depuis le serveur (tenant_settings),
  //    sinon fallback sur config.json local
  ipcMain.handle('get-modules', async () => {
    try {
      // Tenter de récupérer les modules du tenant depuis l'API
      const { apiFetch, getAuthToken } = require('../apiClient');
      const token = getAuthToken && getAuthToken();
      if (token) {
        const r = await apiFetch('/tenant_settings/modules', {
          headers: { 'accept': 'application/json' }
        });
        if (r.ok) {
          const js = await r.json();
          if (js.ok && js.modules) return js.modules;
        }
      }
    } catch (e) {
      console.warn('[modules:get] impossible de récupérer depuis serveur:', e?.message || e);
    }
    // Fallback : config local
    const cfg = readConfig();
    return cfg.modules || {};
  });

  ipcMain.handle('modules:get', async () => {
    try {
      const { apiFetch, getAuthToken } = require('../apiClient');
      const token = getAuthToken && getAuthToken();
      if (token) {
        const r = await apiFetch('/tenant_settings/modules', {
          headers: { 'accept': 'application/json' }
        });
        if (r.ok) {
          const js = await r.json();
          if (js.ok && js.modules) return js.modules;
        }
      }
    } catch (e) {
      console.warn('[modules:get] impossible de récupérer depuis serveur:', e?.message || e);
    }
    const cfg = readConfig();
    return cfg.modules || {};
  });

  // SETTERS
  // Alias historique : "modules:save"
  ipcMain.handle('modules:save', (_e, modulesMap = {}) => {
    const cfg = readConfig();
    const current = cfg.modules || {};

    // ne garder que des booléens
    const sanitized = {};
    for (const [k, v] of Object.entries(modulesMap || {})) {
      if (typeof v === 'boolean') sanitized[k] = v;
    }

    const normalized = normalizeModules(current, sanitized);
    const saved = writeConfig({ modules: normalized }); // merge profond dans db/config
    broadcastConfig(saved);
    return { ok: true, modules: saved.modules || {} };
  });

  // Setter principal : "set-modules"
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
