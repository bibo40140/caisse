// scripts/count-with-electron.js
const path = require('path');

// ⚠️ On charge le MÊME module que l'app : il crée les tables si besoin
const db = require(path.join(__dirname, 'src', 'main', 'db', 'db'));

const r = db.prepare('SELECT COUNT(*) AS n FROM produits').get();
console.log('Produits locaux =', r?.n ?? 0);
process.exit(0);
