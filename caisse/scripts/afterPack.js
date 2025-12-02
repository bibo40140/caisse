/**
 * Hook electron-builder: copie les node_modules de l'API après packaging
 */
const fs = require('fs-extra');
const path = require('path');

exports.default = async function(context) {
  const { appOutDir } = context;
  const apiSource = path.join(__dirname, '../../caisse-api/node_modules');
  const apiDest = path.join(appOutDir, 'resources/api/node_modules');
  
  console.log('[afterPack] Copie des node_modules de l\'API...');
  console.log('  Source:', apiSource);
  console.log('  Destination:', apiDest);
  
  if (!fs.existsSync(apiSource)) {
    console.error('[afterPack] ERREUR: node_modules source non trouvé!');
    console.error('  Exécutez: cd ../caisse-api && npm install --production');
    return;
  }
  
  // Copier les node_modules
  await fs.copy(apiSource, apiDest, {
    filter: (src) => {
      // Exclure les fichiers inutiles pour réduire la taille
      const basename = path.basename(src);
      if (basename === '.bin') return false;
      if (basename.endsWith('.md')) return false;
      if (basename === 'test' || basename === 'tests' || basename === '__tests__') return false;
      return true;
    }
  });
  
  console.log('[afterPack] ✅ node_modules de l\'API copiés avec succès!');
  
  // NE PAS copier le .env pour des raisons de sécurité !
  // L'API lira le .env depuis caisse-api/ en mode dev
  // En production, les variables d'environnement doivent être configurées sur le serveur
  console.log('[afterPack] ⚠️ .env NON copié (sécurité) - L\'API doit avoir ses propres variables d\'environnement');
};
