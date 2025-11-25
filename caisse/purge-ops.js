// Script temporaire pour purger les anciennes ops
const db = require('./src/main/db/db');

try {
  console.log('Suppression de toutes les ops...');
  const result = db.prepare('DELETE FROM ops_queue').run();
  console.log(`✅ ${result.changes} ops supprimées`);
  
  console.log('VACUUM...');
  db.exec('VACUUM');
  console.log('✅ Base compactée');
  
  console.log('✅ Terminé !');
} catch (e) {
  console.error('❌ Erreur:', e.message);
  process.exit(1);
}
