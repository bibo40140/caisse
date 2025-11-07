// scripts/seed-payment-modes.electron.js
const { app } = require('electron');
const db = require('../src/main/db/db');

function seed() {
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
    VALUES (@nom, @taux, @fixe, 1)
    ON CONFLICT(nom) DO UPDATE SET
      taux_percent = excluded.taux_percent,
      frais_fixe   = excluded.frais_fixe,
      actif        = 1
  `);

  upsert.run({ nom: 'Espèces', taux: 0, fixe: 0 });
  upsert.run({ nom: 'CB',      taux: 0, fixe: 0 });

  console.log('✅ Modes de paiement semés: Espèces, CB');
}

app.whenReady()
  .then(() => { seed(); app.quit(); })
  .catch((e) => { console.error(e); app.quit(); });
