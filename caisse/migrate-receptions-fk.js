// migrate-receptions-fk.js
// Script de migration pour supprimer la contrainte FK sur receptions.fournisseur_id

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Trouver toutes les bases de données tenant
const dbDir = path.join(__dirname, 'db');
const dbFiles = fs.readdirSync(dbDir).filter(f => f.endsWith('.db'));

if (dbFiles.length === 0) {
  console.error('❌ Aucune base de données trouvée dans:', dbDir);
  process.exit(1);
}

console.log(`📂 ${dbFiles.length} base(s) de données trouvée(s)`);

function migrateDatabase(dbPath) {
  console.log('\n📂 Migration de:', dbPath);
  const db = new Database(dbPath);

  try {
    console.log('  🔧 Début de la migration...');
    
    // Vérifier si la table existe
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='receptions'").all();
    if (tables.length === 0) {
      console.log('  ⏭️  Table receptions n\'existe pas, skip');
      db.close();
      return;
    }
    
    db.exec('PRAGMA foreign_keys = OFF;');
    
    db.exec(`
      BEGIN TRANSACTION;

      -- Sauvegarder les données existantes
      CREATE TABLE receptions_backup AS SELECT * FROM receptions;
      CREATE TABLE lignes_reception_backup AS SELECT * FROM lignes_reception;

      -- Supprimer les anciennes tables
      DROP TABLE IF EXISTS lignes_reception;
      DROP TABLE IF EXISTS receptions;

      -- Recréer la table receptions SANS FK sur fournisseur_id
      CREATE TABLE receptions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        fournisseur_id INTEGER,
        date           TEXT DEFAULT (datetime('now','localtime')),
        reference      TEXT,
        updated_at     TEXT DEFAULT (datetime('now','localtime')),
        remote_uuid    TEXT UNIQUE
      );

      -- Recréer lignes_reception
      CREATE TABLE lignes_reception (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        reception_id   INTEGER NOT NULL,
        produit_id     INTEGER NOT NULL,
        quantite       REAL NOT NULL,
        prix_unitaire  REAL,
        updated_at     TEXT DEFAULT (datetime('now','localtime')),
        remote_uuid    TEXT UNIQUE,
        FOREIGN KEY (reception_id) REFERENCES receptions(id) ON DELETE CASCADE,
        FOREIGN KEY (produit_id)   REFERENCES produits(id)   ON DELETE CASCADE
      );

      -- Restaurer les données
      INSERT INTO receptions (id, fournisseur_id, date, reference, updated_at, remote_uuid)
      SELECT id, fournisseur_id, date, reference, updated_at, remote_uuid FROM receptions_backup;

      INSERT INTO lignes_reception (id, reception_id, produit_id, quantite, prix_unitaire, updated_at, remote_uuid)
      SELECT id, reception_id, produit_id, quantite, prix_unitaire, updated_at, remote_uuid FROM lignes_reception_backup;

      -- Supprimer les sauvegardes
      DROP TABLE receptions_backup;
      DROP TABLE lignes_reception_backup;

      COMMIT;
    `);

    db.exec('PRAGMA foreign_keys = ON;');

    console.log('  ✅ Migration terminée avec succès !');
    
  } catch (error) {
    console.error('  ❌ Erreur lors de la migration:', error.message);
    try { db.exec('ROLLBACK;'); } catch {}
  } finally {
    db.close();
  }
}

// Migrer toutes les bases
dbFiles.forEach(file => {
  const dbPath = path.join(dbDir, file);
  migrateDatabase(dbPath);
});

console.log('\n✅ Toutes les migrations sont terminées !');
