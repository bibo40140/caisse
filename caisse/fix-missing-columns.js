// fix-missing-columns.js
// Script pour ajouter les colonnes manquantes sur toutes les bases
const { app } = require('electron');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Mode CLI Electron
if (!app.isReady()) {
  app.whenReady().then(() => {
    runMigration();
    app.quit();
  });
} else {
  runMigration();
  app.quit();
}

function runMigration() {
  const dbPath = process.argv[process.argv.length - 1];

  if (!dbPath || dbPath.includes('fix-missing-columns')) {
    console.error('Usage: electron fix-missing-columns.js <chemin/vers/base.db>');
    return;
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`Erreur: ${dbPath} n'existe pas`);
    return;
  }

  console.log(`Correction de ${dbPath}...`);

  const db = new Database(dbPath);

try {
  db.pragma('foreign_keys = OFF');

  // Vérifier et ajouter created_at sur ventes
  const ventesColumns = db.prepare('PRAGMA table_info(ventes)').all();
  const hasVentesCreatedAt = ventesColumns.some(col => col.name === 'created_at');
  
  if (!hasVentesCreatedAt) {
    console.log('Ajout de created_at sur ventes...');
    db.exec('ALTER TABLE ventes ADD COLUMN created_at TEXT');
    db.exec("UPDATE ventes SET created_at = date_vente WHERE created_at IS NULL");
    console.log('✅ ventes.created_at ajoutée');
  } else {
    console.log('⏭️  ventes.created_at déjà présente');
  }

  // Vérifier et ajouter created_at sur produits
  const produitsColumns = db.prepare('PRAGMA table_info(produits)').all();
  const hasProduitsCreatedAt = produitsColumns.some(col => col.name === 'created_at');
  
  if (!hasProduitsCreatedAt) {
    console.log('Ajout de created_at sur produits...');
    db.exec('ALTER TABLE produits ADD COLUMN created_at TEXT');
    db.exec("UPDATE produits SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL");
    console.log('✅ produits.created_at ajoutée');
  } else {
    console.log('⏭️  produits.created_at déjà présente');
  }

  // Vérifier et ajouter created_at sur lignes_vente
  const lignesVenteColumns = db.prepare('PRAGMA table_info(lignes_vente)').all();
  const hasLignesVenteCreatedAt = lignesVenteColumns.some(col => col.name === 'created_at');
  
  if (!hasLignesVenteCreatedAt) {
    console.log('Ajout de created_at sur lignes_vente...');
    db.exec('ALTER TABLE lignes_vente ADD COLUMN created_at TEXT');
    db.exec("UPDATE lignes_vente SET created_at = COALESCE(updated_at, datetime('now','localtime')) WHERE created_at IS NULL");
    console.log('✅ lignes_vente.created_at ajoutée');
  } else {
    console.log('⏭️  lignes_vente.created_at déjà présente');
  }

  db.pragma('foreign_keys = ON');
    
    console.log('\n✅ Migration terminée avec succès !');
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    db.close();
  }
}
