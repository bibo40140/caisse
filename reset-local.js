// scripts/reset-local.js
const path = require('path');
const Database = require('better-sqlite3');

// adapte si besoin (c'est le même chemin que src/main/db/db.js utilise)
const dbPath = path.resolve(__dirname, 'coopaz.db');
const db = new Database(dbPath);

db.exec('BEGIN');
db.exec('DELETE FROM lignes_vente;');
db.exec('DELETE FROM lignes_reception;');
db.exec('DELETE FROM ventes;');
db.exec('DELETE FROM receptions;');
db.exec('DELETE FROM produits;');
db.exec('DELETE FROM ops_queue;');
db.exec('COMMIT;');

console.log('Local reset OK.');
