// Script pour ajouter la colonne meta à stock_movements dans les bases existantes
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'db');
const files = fs.readdirSync(dbDir).filter(f => f.endsWith('.db') && !f.includes('backup'));

console.log(`📂 Traitement de ${files.length} base(s) de données...`);

for (const file of files) {
  const dbPath = path.join(dbDir, file);
  console.log(`\n🔧 Traitement: ${file}`);
  
  try {
    const db = new Database(dbPath);
    
    // Vérifier si la colonne meta existe déjà
    const columns = db.prepare(`PRAGMA table_info(stock_movements)`).all();
    const hasMetaColumn = columns.some(col => col.name === 'meta');
    
    if (hasMetaColumn) {
      console.log('   ✅ La colonne meta existe déjà, rien à faire');
      db.close();
      continue;
    }
    
    // Ajouter la colonne meta
    console.log('   ➕ Ajout de la colonne meta...');
    db.prepare(`ALTER TABLE stock_movements ADD COLUMN meta TEXT`).run();
    
    console.log('   ✅ Colonne meta ajoutée avec succès');
    db.close();
  } catch (err) {
    console.error(`   ❌ Erreur: ${err.message}`);
  }
}

console.log('\n✅ Migration terminée !');
