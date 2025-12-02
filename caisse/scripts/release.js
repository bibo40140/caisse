#!/usr/bin/env node
/**
 * Script de release automatique pour CoopCaisse
 * Usage: npm run release
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 === RELEASE COOPCAISSE ===\n');

// 1. Lire la version actuelle
const pkgPath = path.join(__dirname, '..', 'package.json');
const versionPath = path.join(__dirname, '..', 'version.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

console.log(`📦 Version actuelle: ${pkg.version}`);
console.log(`📅 Date du build: ${versionData.buildDate}\n`);

// 2. Demander si on veut incrémenter la version
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.question('Incrémenter la version ? (patch/minor/major/non) [patch]: ', (answer) => {
  const type = answer.trim().toLowerCase() || 'patch';
  
  if (type !== 'non') {
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    
    switch(type) {
      case 'major':
        pkg.version = `${major + 1}.0.0`;
        break;
      case 'minor':
        pkg.version = `${major}.${minor + 1}.0`;
        break;
      case 'patch':
      default:
        pkg.version = `${major}.${minor}.${patch + 1}`;
        break;
    }
    
    // Mettre à jour version.json
    versionData.version = pkg.version;
    versionData.buildDate = new Date().toISOString().split('T')[0];
    
    // Sauvegarder
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
    
    console.log(`\n✅ Nouvelle version: ${pkg.version}`);
  }
  
  readline.close();
  
  // 3. Nettoyer le dossier dist-release
  console.log('\n🧹 Nettoyage du dossier dist-release...');
  try {
    const distPath = path.join(__dirname, '..', 'dist-release');
    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true });
    }
  } catch(e) {
    console.warn('⚠️  Impossible de nettoyer dist-release:', e.message);
  }
  
  // 4. Build
  console.log('\n🔨 Build en cours (cela peut prendre 5-10 minutes)...');
  console.log('📦 Bundling de l\'application et de l\'API...\n');
  
  try {
    execSync('npm run build', { stdio: 'inherit' });
    
    console.log('\n\n🎉 === BUILD TERMINÉ ===');
    console.log(`\n📦 Version: ${pkg.version}`);
    console.log(`📂 Fichiers générés dans: dist-release/`);
    console.log(`📥 Installeur: dist-release/CoopCaisse Setup ${pkg.version}.exe`);
    console.log(`📤 Prêt pour upload sur GitHub Releases\n`);
    
    // Afficher les instructions
    console.log('📋 PROCHAINES ÉTAPES:');
    console.log('1. Testez l\'installeur: dist-release/CoopCaisse Setup ' + pkg.version + '.exe');
    console.log('2. Créez une release sur GitHub:');
    console.log('   - Allez sur https://github.com/bibo40140/caisse/releases/new');
    console.log('   - Tag: v' + pkg.version);
    console.log('   - Titre: CoopCaisse v' + pkg.version);
    console.log('   - Uploadez le fichier .exe');
    console.log('   - Uploadez aussi latest.yml pour l\'auto-update');
    console.log('3. Publiez la release ✅\n');
    
  } catch (e) {
    console.error('\n❌ Erreur lors du build:', e.message);
    process.exit(1);
  }
});
