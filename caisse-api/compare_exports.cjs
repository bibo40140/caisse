// compare_exports.cjs
// Compare les fichiers JSON de deux dossiers (structure et données)
const fs = require('fs').promises;
const path = require('path');

async function listFiles(dir) {
  const files = await fs.readdir(dir);
  return files.filter(f => f.endsWith('.json')).sort();
}

async function loadJson(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

async function compareDirs(dirA, dirB) {
  const filesA = await listFiles(dirA);
  const filesB = await listFiles(dirB);
  const allFiles = Array.from(new Set([...filesA, ...filesB])).sort();

  for (const file of allFiles) {
    const fileA = path.join(dirA, file);
    const fileB = path.join(dirB, file);
    const existsA = filesA.includes(file);
    const existsB = filesB.includes(file);
    if (!existsA) {
      console.log(`❌ ${file} absent dans ${dirA}`);
      continue;
    }
    if (!existsB) {
      console.log(`❌ ${file} absent dans ${dirB}`);
      continue;
    }
    const dataA = await loadJson(fileA);
    const dataB = await loadJson(fileB);
    if (!Array.isArray(dataA) || !Array.isArray(dataB)) {
      console.log(`⚠️  ${file} n'est pas un tableau JSON dans un des dossiers`);
      continue;
    }
    // Compare structure (clés)
    const keysA = new Set(dataA.flatMap(row => Object.keys(row)));
    const keysB = new Set(dataB.flatMap(row => Object.keys(row)));
    const diffA = [...keysA].filter(k => !keysB.has(k));
    const diffB = [...keysB].filter(k => !keysA.has(k));
    if (diffA.length || diffB.length) {
      console.log(`🔑 Différence de structure dans ${file}:`);
      if (diffA.length) console.log(`   - Clés seulement dans A: ${diffA.join(', ')}`);
      if (diffB.length) console.log(`   - Clés seulement dans B: ${diffB.join(', ')}`);
    }
    // Compare nombre de lignes
    if (dataA.length !== dataB.length) {
      console.log(`#️⃣  Différence de lignes dans ${file}: ${dataA.length} (A) vs ${dataB.length} (B)`);
    }
    // Compare contenu (optionnel, ici on compare juste les ids si présents)
    const idKey = ['id', 'uuid', 'ID'].find(k => dataA[0] && k in dataA[0]);
    if (idKey) {
      const idsA = new Set(dataA.map(r => r[idKey]));
      const idsB = new Set(dataB.map(r => r[idKey]));
      const onlyA = [...idsA].filter(x => !idsB.has(x));
      const onlyB = [...idsB].filter(x => !idsA.has(x));
      if (onlyA.length) console.log(`   - ${file}: ${onlyA.length} id(s) seulement dans A`);
      if (onlyB.length) console.log(`   - ${file}: ${onlyB.length} id(s) seulement dans B`);
    }
  }
}

// Dossiers à comparer (adapter si besoin)
const dirA = path.resolve(__dirname, './db_export_sqlite');
const dirB = path.resolve(__dirname, './db_export_neon');

compareDirs(dirA, dirB).catch(console.error);
