import pg from 'pg';
const { Pool } = pg;

async function closeAllSessions() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const result = await db.query(
      `UPDATE inventory_sessions SET status = 'closed', ended_at = NOW() WHERE status = 'open'`
    );
    console.log(`✅ Fermé ${result.rowCount} session(s) d'inventaire`);
    
    // Supprimer les comptages orphelins
    const deleteResult = await db.query(`DELETE FROM inventory_counts WHERE session_id NOT IN (SELECT id FROM inventory_sessions)`);
    console.log(`✅ Supprimé ${deleteResult.rowCount} comptage(s) orphelin(s)`);
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    await db.end();
  }
}

closeAllSessions();
