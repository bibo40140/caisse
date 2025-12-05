// debug-pending-ops.js
// Affiche les opérations en attente pour déboguer les blocages
const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

if (!app.isReady()) {
  app.whenReady().then(() => {
    runDebug();
    app.quit();
  });
} else {
  runDebug();
  app.quit();
}

function runDebug() {
  const dbPath = process.argv[process.argv.length - 1];
  if (!dbPath || dbPath.includes('debug-pending-ops')) {
    console.error('Usage: electron debug-pending-ops.js <chemin/vers/tenant.db>');
    return;
  }

  const db = new Database(dbPath, { readonly: true });

console.log('\n=== OPÉRATIONS EN ATTENTE ===\n');

const ops = db.prepare(`
  SELECT 
    id, 
    op_type, 
    entity_type, 
    entity_id, 
    retry_count, 
    last_error,
    created_at,
    failed_at,
    substr(payload_json, 1, 100) as payload_preview
  FROM ops_queue 
  ORDER BY created_at ASC
  LIMIT 50
`).all();

if (ops.length === 0) {
  console.log('✅ Aucune opération en attente');
} else {
  console.log(`⚠️  ${ops.length} opération(s) en attente:\n`);
  
  ops.forEach((op, i) => {
    console.log(`${i + 1}. [${op.op_type}] ${op.entity_type} #${op.entity_id}`);
    console.log(`   ID: ${op.id}`);
    console.log(`   Créée: ${op.created_at}`);
    console.log(`   Retry: ${op.retry_count || 0}`);
    if (op.last_error) console.log(`   Erreur: ${op.last_error}`);
    if (op.failed_at) console.log(`   Échec: ${op.failed_at}`);
    console.log(`   Payload: ${op.payload_preview}...`);
    console.log('');
  });
  }

  db.close();
}
