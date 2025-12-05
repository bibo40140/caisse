// migrate-all-local-dbs.js
// Script pour migrer TOUTES les bases SQLite locales du dossier db/
// Usage: node migrate-all-local-dbs.js

const fs = require('fs');
const path = require('path');
const { runMigration } = require('./migrate-local-schema.js');

const dbDir = path.join(__dirname, 'db');

console.log(`\n====================================`);
console.log(`Migration de toutes les bases SQLite`);
console.log(`Dossier: ${dbDir}`);
console.log(`====================================\n`);

// Vérifier que le dossier db/ existe
if (!fs.existsSync(dbDir)) {
  console.error(`❌ Erreur: Le dossier '${dbDir}' n'existe pas.`);
  process.exit(1);
}

// Lister tous les fichiers .db
const dbFiles = fs.readdirSync(dbDir)
  .filter(f => f.endsWith('.db') && !f.includes('.backup-'))
  .map(f => path.join(dbDir, f));

if (dbFiles.length === 0) {
  console.log(`⚠️  Aucun fichier .db trouvé dans ${dbDir}`);
  process.exit(0);
}

console.log(`📋 ${dbFiles.length} base(s) de données trouvée(s):\n`);
dbFiles.forEach((f, i) => console.log(`   ${i + 1}. ${path.basename(f)}`));
console.log();

// Demander confirmation
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Voulez-vous continuer ? (oui/non): ', (answer) => {
  rl.close();

  if (answer.toLowerCase() !== 'oui') {
    console.log('Migration annulée.');
    process.exit(0);
  }

  // Migrer chaque base
  let successCount = 0;
  let errorCount = 0;

  for (const dbPath of dbFiles) {
    try {
      runMigration(dbPath);
      successCount++;
    } catch (err) {
      console.error(`❌ Erreur lors de la migration de ${path.basename(dbPath)}:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n====================================`);
  console.log(`📊 Résumé global:`);
  console.log(`   ✅ Succès: ${successCount}/${dbFiles.length}`);
  console.log(`   ❌ Erreurs: ${errorCount}/${dbFiles.length}`);
  console.log(`====================================\n`);
});
