// scripts/seed-payment-modes.js
const path = require('path');
const Database = require('better-sqlite3');

// adapte ce chemin si ton tenant DB est ailleurs
const DB_PATH = path.join(__dirname, '..', 'coopaz.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS modes_paiement (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom          TEXT UNIQUE NOT NULL,
    taux_percent REAL DEFAULT 0,
    frais_fixe   REAL DEFAULT 0,
    actif        INTEGER DEFAULT 1
  );
`);

const upsert = db.prepare(`
  INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
  VALUES (@nom, @taux_percent, @frais_fixe, 1)
  ON CONFLICT(nom) DO UPDATE SET
    taux_percent=excluded.taux_percent,
    frais_fixe=excluded.frais_fixe,
    actif=1
`);

['Espèces','CB'].forEach(nom => upsert.run({ nom, taux_percent: 0, frais_fixe: 0 }));
console.log('OK: modes de paiement semés (Espèces, CB).');
