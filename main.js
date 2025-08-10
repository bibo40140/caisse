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
const config = require('./config.json');

require('./src/main/handlers/produits');
require('./src/main/handlers/categories')();
require('./src/main/handlers/unites')(ipcMain);



if (config.modules.fournisseurs) {
  require('./src/main/handlers/fournisseurs')();
}
if (config.modules.adherents) {
  require('./src/main/handlers/adherents')();
}

if (config.modules.cotisations) {
  require('./src/main/handlers/cotisations');
}

if (config.modules.imports !== false) {
  require('./src/main/handlers/imports'); // ← suffisant
}

if (config.modules.stock) {
  require('./src/main/handlers/stock');
}

if (config.modules.receptions) {
  require('./src/main/handlers/receptions').registerReceptionHandlers(ipcMain);
}

if (config.modules.ventes) {
  require('./src/main/handlers/ventes')(ipcMain);
}

if (config.modules.email) {
  require('./src/main/handlers/email')(ipcMain);
}


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

// ✅ Ajouter les catégories par défaut si elles n'existent pas encore
const CATEGORIES_PAR_DEFAUT = [
  'Maraicher', 'Grossiste', 'Boulanger', 'Spiritueux', 'Producteur',
  'Charcutier', 'Pecheur', 'Volailler', 'Fromager', 'Hygiene',
  'Minotier', 'Crémier', 'Apiculteur'
];

const categoriesExistantes = db.prepare('SELECT nom FROM categories').all().map(c => c.nom.toLowerCase());
const insertCategorie = db.prepare('INSERT INTO categories (nom) VALUES (?)');

const insertCategoriesDefaut = db.transaction((categories) => {
  for (const cat of categories) {
    if (!categoriesExistantes.includes(cat.toLowerCase())) {
      insertCategorie.run(cat);
    }
  }
});
insertCategoriesDefaut(CATEGORIES_PAR_DEFAUT);





// -----------------------------------------------------------------------------
// 1) Création de la fenêtre
// -----------------------------------------------------------------------------
function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
	  preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);




// Liste de tranches d'âge proposées
const TRANCHES_AGE_VALIDES = [
  "18-25", "26-35", "36-45", "46-55", "56-65", "66+"
];


