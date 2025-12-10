// Debug inventory_counts table
const db = require('./src/main/db/db');

console.log('\n===== DEBUG INVENTORY COUNTS =====\n');

try {
  const counts = db.prepare(`
    SELECT 
      ic.session_id,
      ic.produit_id,
      p.nom,
      SUM(ic.qty) as total_qty,
      COUNT(*) as nb_entries
    FROM inventory_counts ic
    LEFT JOIN produits p ON ic.produit_id = p.id
    GROUP BY ic.session_id, ic.produit_id
    ORDER BY ic.session_id DESC, ic.produit_id
  `).all();

  console.log('Comptages par session:');
  console.log(JSON.stringify(counts, null, 2));
  
  const sessions = db.prepare(`
    SELECT id, remote_uuid, name, status, started_at
    FROM inventory_sessions
    ORDER BY id DESC
    LIMIT 5
  `).all();
  
  console.log('\nDernières sessions:');
  console.log(JSON.stringify(sessions, null, 2));

} catch (e) {
  console.error('[DEBUG] Error:', e.message);
}

process.exit(0);
