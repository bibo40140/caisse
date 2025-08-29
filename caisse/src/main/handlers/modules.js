// src/main/handlers/modules.js
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../../../config.json');

function readConfig() {
  if (!fs.existsSync(configPath)) {
    return { modules: {} };
  }
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erreur lecture config.json:', err);
    return { modules: {} };
  }
}

function writeConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Erreur écriture config.json:', err);
  }
}

ipcMain.handle('get-modules', () => {
  const cfg = readConfig();
  return cfg.modules || {};
});

ipcMain.handle('set-modules', async (_event, newModules) => {
  if (!newModules || typeof newModules !== 'object') {
    throw new Error('Modules invalides');
  }
  // validation légère: booléens uniquement
  for (const [k, v] of Object.entries(newModules)) {
    if (typeof v !== 'boolean') {
      throw new Error(`Le module "${k}" doit être un booléen`);
    }
  }

  const cfg = readConfig();
  const current = cfg.modules || {};

  // merge (on n'écrase pas les autres clés non envoyées)
  const next = { ...current, ...newModules };

  // --- Dépendances / règles métier (on conserve tes règles) ---
  if (!next.adherents) {
    next.cotisations = false;
    // UI / envoi mails
    next.emails = false;
    next.email  = false;
  }
  if (!next.stocks) {
    next.inventaire = false;
    // ✅ On garde "receptions" possible même sans "stocks" (création produits + MAJ prix uniquement)
  }
  if (!next.fournisseurs) {
    next.receptions = false;
  }
  // On aligne définitivement "réceptions" sur "stocks" (comme ton commentaire)
  next.receptions = !!next.stocks;

  // --- Normalisation email/emails (cohérence UI <-> main) ---
  if (typeof next.emails === 'boolean' && typeof next.email !== 'boolean') {
    next.email = next.emails;
  }
  if (typeof next.email === 'boolean' && typeof next.emails !== 'boolean') {
    next.emails = next.email;
  }

  // --- Valeur par défaut pour ventes_exterieur si absente ---
  if (typeof next.ventes_exterieur !== 'boolean') {
    next.ventes_exterieur = false;
  }

  cfg.modules = next;
  writeConfig(cfg);

  // renvoyer l’état à jour (plus pratique côté UI)
  return next;
});
