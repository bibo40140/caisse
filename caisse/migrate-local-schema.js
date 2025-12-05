// migrate-local-schema.js
// Script Node.js pour appliquer la migration SQLite locale de manière sécurisée
// Usage: node migrate-local-schema.js [chemin/vers/base.db]

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Fonction pour lire et exécuter le script SQL
function runMigration(dbPath) {
  console.log(`\n====================================`);
  console.log(`Migration du schéma SQLite`);
  console.log(`Base de données: ${dbPath}`);
  console.log(`====================================\n`);

  // Vérifier que la base existe
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Erreur: La base de données '${dbPath}' n'existe pas.`);
    process.exit(1);
  }

  // Créer une sauvegarde
  const backupPath = `${dbPath}.backup-${Date.now()}`;
  console.log(`📦 Création d'une sauvegarde: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✅ Sauvegarde créée avec succès.\n`);

  // Ouvrir la base
  console.log(`🔓 Ouverture de la base de données...`);
  const db = new Database(dbPath);

  try {
    console.log(`📝 Application de la migration SQLite...\n`);

    // Désactiver les FK temporairement
    db.pragma('foreign_keys = OFF');

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Helper: ajouter une colonne si elle n'existe pas
    const addColumnIfNotExists = (tableName, columnName, columnDef) => {
      try {
        const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
        const columnExists = tableInfo.some(col => col.name === columnName);
        
        if (columnExists) {
          console.log(`⏭️  ${tableName}.${columnName} déjà présente`);
          skipCount++;
          return;
        }
        
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
        console.log(`✅ ${tableName}.${columnName} ajoutée`);
        successCount++;
      } catch (err) {
        if (err.message.includes('duplicate column')) {
          console.log(`⏭️  ${tableName}.${columnName} déjà présente`);
          skipCount++;
        } else {
          console.error(`❌ ${tableName}.${columnName}:`, err.message);
          errorCount++;
        }
      }
    };

    // Helper: créer une table si elle n'existe pas
    const createTableIfNotExists = (tableName, createStmt) => {
      try {
        const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
        if (exists) {
          console.log(`⏭️  Table '${tableName}' déjà présente`);
          skipCount++;
          return;
        }
        
        db.exec(createStmt);
        console.log(`✅ Table '${tableName}' créée`);
        successCount++;
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`⏭️  Table '${tableName}' déjà présente`);
          skipCount++;
        } else {
          console.error(`❌ Table '${tableName}':`, err.message);
          errorCount++;
        }
      }
    };

    // 1. Ajouter les colonnes manquantes
    console.log('\n[1/6] Ajout des colonnes manquantes...');
    addColumnIfNotExists('produits', 'created_at', "TEXT DEFAULT (datetime('now','localtime'))");
    addColumnIfNotExists('ventes', 'created_at', "TEXT DEFAULT (datetime('now','localtime'))");
    addColumnIfNotExists('lignes_vente', 'created_at', "TEXT DEFAULT (datetime('now','localtime'))");
    addColumnIfNotExists('lignes_reception', 'created_at', "TEXT DEFAULT (datetime('now','localtime'))");
    addColumnIfNotExists('inventory_sessions', 'user', "TEXT");
    addColumnIfNotExists('inventory_sessions', 'notes', "TEXT");
    addColumnIfNotExists('inventory_counts', 'updated_at', "TEXT DEFAULT (datetime('now','localtime'))");
    
    // Initialiser les valeurs par défaut
    try {
      db.exec(`UPDATE produits SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL`);
      db.exec(`UPDATE ventes SET created_at = date_vente WHERE created_at IS NULL`);
      db.exec(`UPDATE lignes_vente SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL`);
      db.exec(`UPDATE lignes_reception SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL`);
      db.exec(`UPDATE inventory_counts SET updated_at = COALESCE(created_at, datetime('now','localtime')) WHERE updated_at IS NULL`);
      console.log(`✅ Valeurs par défaut initialisées`);
      successCount++;
    } catch (err) {
      console.error(`❌ Initialisation des valeurs:`, err.message);
      errorCount++;
    }

    // 2. Créer les tables manquantes
    console.log('\n[2/6] Création des tables manquantes...');
    
    createTableIfNotExists('stock_movements', `
      CREATE TABLE stock_movements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        produit_id  INTEGER NOT NULL,
        delta       REAL NOT NULL,
        source      TEXT NOT NULL,
        source_id   TEXT,
        created_at  TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
      )
    `);
    
    createTableIfNotExists('inventory_snapshot', `
      CREATE TABLE inventory_snapshot (
        session_id  INTEGER NOT NULL,
        produit_id  INTEGER NOT NULL,
        stock_start REAL,
        unit_cost   REAL,
        PRIMARY KEY (session_id, produit_id),
        FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
      )
    `);
    
    createTableIfNotExists('inventory_adjust', `
      CREATE TABLE inventory_adjust (
        session_id    INTEGER NOT NULL,
        produit_id    INTEGER NOT NULL,
        stock_start   REAL,
        counted_total REAL,
        delta         REAL,
        unit_cost     REAL,
        delta_value   REAL,
        created_at    TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (session_id, produit_id),
        FOREIGN KEY (session_id) REFERENCES inventory_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
      )
    `);

    // 3. Créer les index
    console.log('\n[3/6] Création des index...');
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_stock_movements_produit ON stock_movements(produit_id)",
      "CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at)",
      "CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source)",
      "CREATE INDEX IF NOT EXISTS idx_inventory_snapshot_session ON inventory_snapshot(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_inventory_snapshot_produit ON inventory_snapshot(produit_id)",
      "CREATE INDEX IF NOT EXISTS idx_inventory_adjust_session ON inventory_adjust(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_inventory_adjust_produit ON inventory_adjust(produit_id)",
    ];
    
    indexes.forEach(idx => {
      try {
        db.exec(idx);
        successCount++;
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.error(`❌ Index:`, err.message);
          errorCount++;
        } else {
          skipCount++;
        }
      }
    });
    console.log(`✅ ${indexes.length} index créés/vérifiés`);

    // 4-6: Les renommages de colonnes et harmonisations de types sont plus complexes
    // On les saute pour l'instant car ils nécessitent de recréer les tables
    console.log('\n[4/6] Renommage de colonnes (ignoré - nécessite recréation de tables)');
    console.log('[5/6] Harmonisation des types (ignoré - nécessite recréation de tables)');
    console.log('[6/6] Finalisation...');

    // Réactiver les FK
    db.pragma('foreign_keys = ON');

    console.log(`\n====================================`);
    console.log(`📊 Résumé de la migration:`);
    console.log(`   ✅ Succès: ${successCount}`);
    console.log(`   ⏭️  Ignorées: ${skipCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}`);
    console.log(`====================================\n`);

    // Vérification finale
    console.log(`🔍 Vérification des tables principales...`);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%' 
      ORDER BY name
    `).all();

    console.log(`\n📋 Tables présentes (${tables.length}):`);
    tables.forEach(t => console.log(`   - ${t.name}`));

    // Vérifier les colonnes critiques
    console.log(`\n🔍 Vérification des colonnes ajoutées...`);
    const checks = [
      { table: 'produits', column: 'created_at' },
      { table: 'ventes', column: 'created_at' },
      { table: 'lignes_vente', column: 'created_at' },
      { table: 'receptions', column: 'created_at' },
      { table: 'inventory_sessions', column: 'user' },
      { table: 'inventory_counts', column: 'updated_at' },
      { table: 'stock_movements', column: 'delta' },
      { table: 'inventory_snapshot', column: 'stock_start' },
      { table: 'inventory_adjust', column: 'delta' },
    ];

    checks.forEach(({ table, column }) => {
      try {
        const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
        const hasColumn = tableInfo.some(col => col.name === column);
        if (hasColumn) {
          console.log(`   ✅ ${table}.${column}`);
        } else {
          console.log(`   ❌ ${table}.${column} (manquante)`);
        }
      } catch (err) {
        console.log(`   ⚠️  ${table}.${column} (table non trouvée)`);
      }
    });

    if (errorCount === 0) {
      console.log(`\n✅ Migration terminée avec succès !`);
      console.log(`📦 Sauvegarde disponible: ${backupPath}\n`);
    } else {
      console.log(`\n⚠️  Migration terminée avec des erreurs.`);
      console.log(`📦 Sauvegarde disponible: ${backupPath}`);
      console.log(`💡 Vous pouvez restaurer avec: mv ${backupPath} ${dbPath}\n`);
    }

  } catch (err) {
    console.error(`\n❌ Erreur fatale lors de la migration:`, err);
    console.log(`\n🔄 Restauration de la sauvegarde...`);
    db.close();
    fs.copyFileSync(backupPath, dbPath);
    console.log(`✅ Base restaurée depuis: ${backupPath}\n`);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Point d'entrée
if (require.main === module) {
  const dbPath = process.argv[2];
  
  if (!dbPath) {
    console.error(`Usage: node migrate-local-schema.js <chemin/vers/base.db>`);
    console.error(`\nExemple: node migrate-local-schema.js ./db/tenant_xxx.db`);
    process.exit(1);
  }

  runMigration(path.resolve(dbPath));
}

module.exports = { runMigration };
