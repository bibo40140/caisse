// src/main/handlers/config.js
const { readConfig, writeModules, writeConfig } = require('../db/config');

// 🔒 Clés autorisées dans modules (whitelist)
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
  'ventes_exterieur'
];

module.exports = function registerConfigHandlers(ipcMain) {
  // Lire toute la config
  ipcMain.handle('config:get', async () => {
    return readConfig();
  });

  // Mettre à jour les modules
  ipcMain.handle('config:update-modules', async (_e, modules) => {
    if (!modules || typeof modules !== 'object') {
      throw new Error('Modules invalides');
    }

    // ✅ Ne garder que les clés autorisées et s’assurer que ce sont des booléens
    const sanitized = {};
    for (const [k, v] of Object.entries(modules)) {
      if (!ALLOWED_MODULE_KEYS.includes(k)) continue;
      if (typeof v !== 'boolean') {
        throw new Error(`Le module "${k}" doit être un booléen`);
      }
      sanitized[k] = v;
    }

    // Harmonisation email/emails
    if ('emails' in sanitized && !('email' in sanitized)) sanitized.email = sanitized.emails;
    if ('email' in sanitized && !('emails' in sanitized)) sanitized.emails = sanitized.email;

    writeModules(sanitized);
    const cfg = readConfig();
    return { status: 'ok', config: cfg };
  });

  // 🆕 Lire la marge ventes extérieures
  ipcMain.handle('config:get-ventes-margin', async () => {
    const cfg = readConfig();
    let percent = Number(cfg.ventes_ext_margin_percent);
    if (!Number.isFinite(percent) || percent < 0) percent = 30;
    return { percent };
  });

  // 🆕 Écrire la marge ventes extérieures
  ipcMain.handle('config:set-ventes-margin', async (_e, percent) => {
    let p = Number(percent);
    if (!Number.isFinite(p) || p < 0) throw new Error('Pourcentage invalide');
    if (p > 1000) p = 1000; // limite haute de sécurité
    const updated = writeConfig({ ventes_ext_margin_percent: p });
    return { status: 'ok', percent: updated.ventes_ext_margin_percent };
  });
};
