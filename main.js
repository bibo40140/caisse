// ─────────────────────────────────────────────────────────────
// main.js – version corrigée et fonctionnelle
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const parse = require('csv-parse/sync');
const { dialog } = require('electron');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const db = require('./src/main/db/db');
const XLSX = require('XLSX');
const configPath = path.join(app.getAppPath(), 'config.json');
const config = require(configPath);
const { registerSync } = require('./src/main/sync');



require('./src/main/handlers/config')(ipcMain);
require('./src/main/handlers/produits');
require('./src/main/handlers/unites')(ipcMain);
require('./src/main/handlers/modules');
require('./src/main/handlers/ventes')(ipcMain);

const registerProspectsHandlers = require('./src/main/handlers/prospects');
registerProspectsHandlers(ipcMain);

const { registerCategoryHandlers } = require('./src/main/handlers/categories');
registerCategoryHandlers();

// ⬇️ On enregistre les handlers Prospects (toujours disponibles)

if (config.modules.fournisseurs) {
  require('./src/main/handlers/fournisseurs')();
}
if (config.modules.adherents) {
  require('./src/main/handlers/adherents')(ipcMain);
} else {
  ipcMain.handle('get-adherents', () => []); // renvoie une liste vide sans planter
}

if (config.modules.cotisations) {
  require('./src/main/handlers/cotisations');
}

if (config.modules.imports !== false) {
  require('./src/main/handlers/imports');
}

if (config.modules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
}

// Les réceptions suivent le module Stocks
if (config.modules.stocks) {
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}

if (config.modules.email || config.modules.emails) {
  require('./src/main/handlers/email')(ipcMain);
}

if (config.modules.modes_paiement !== false) {
  require('./src/main/handlers/modes_paiement');
}

registerSync(ipcMain);


// ✅ Ajouter les unités par défaut si elles n'existent pas encore
const unitesParDefaut = ['kg', 'litre', 'pièce'];
const unitesExistantes = db.prepare('SELECT nom FROM unites').all().map(u => u.nom.toLowerCase());

const insertUnite = db.prepare('INSERT INTO unites (nom) VALUES (?)');
const insertUnitesDefaut = db.transaction((unites) => {
  for (const unite of unites) {
    if (!unitesExistantes.includes(unite)) {
      insertUnite.run(unite);
    }
  }
});
insertUnitesDefaut(unitesParDefaut);



// -----------------------------------------------------------------------------
// 1) Création de la fenêtre
// -----------------------------------------------------------------------------
function createWindow () {
  const win = new BrowserWindow({
    show: false, // On attend avant d'afficher
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });

  win.maximize(); // ✅ Maximiser la fenêtre
  win.loadFile('index.html');
  win.show(); // Afficher une fois maximisée
}

app.whenReady().then(createWindow);

// Liste de tranches d'âge proposées
const TRANCHES_AGE_VALIDES = [
  "18-25", "26-35", "36-45", "46-55", "56-65", "66+"
];
