#!/usr/bin/env node
/**
 * Cleanup: Remove duplicate inventory_sessions and their orphaned counts
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Find the database file
const dbDir = path.join(__dirname, 'db');
const dbFiles = fs.readdirSync(dbDir).filter(f => f.endsWith('.db'));

if (dbFiles.length === 0) {
  console.error('❌ No database file found in', dbDir);
  process.exit(1);
}

const dbPath = path.join(dbDir, dbFiles[0]);
console.log(`📂 Opening database: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

try {
  // 1) List all inventory sessions with their counts
  const sessions = db.prepare(`
    SELECT id, remote_uuid, status, COUNT(ic.id) as count_rows
    FROM inventory_sessions is
    LEFT JOIN inventory_counts ic ON ic.session_id = is.id
    GROUP BY is.id
    ORDER BY is.id DESC
  `).all();

  console.log('\n📊 Inventory Sessions:');
  sessions.forEach(s => {
    console.log(`  [${s.id}] UUID=${s.remote_uuid || 'NULL'} Status=${s.status} Counts=${s.count_rows}`);
  });

  // 2) Find duplicate remote_uuids (different id, same remote_uuid)
  const duplicates = db.prepare(`
    SELECT remote_uuid, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM inventory_sessions
    WHERE remote_uuid IS NOT NULL
    GROUP BY remote_uuid
    HAVING COUNT(*) > 1
  `).all();

  if (duplicates.length === 0) {
    console.log('\n✅ No duplicates found');
  } else {
    console.log(`\n⚠️  Found ${duplicates.length} duplicate remote_uuid(s):`);
    duplicates.forEach(dup => {
      console.log(`  UUID=${dup.remote_uuid} appears ${dup.cnt} times (IDs: ${dup.ids})`);
    });

    // 3) Delete old duplicates (keep only the highest ID)
    console.log('\n🗑️  Cleaning up duplicates...');
    const tx = db.transaction(() => {
      for (const dup of duplicates) {
        const ids = dup.ids.split(',').map(Number).sort((a,b) => b-a);
        const keepId = ids[0];
        const deleteIds = ids.slice(1);
        
        console.log(`  Keeping ID=${keepId}, deleting ${deleteIds.join(', ')}`);
        
        for (const deleteId of deleteIds) {
          db.prepare('DELETE FROM inventory_counts WHERE session_id = ?').run(deleteId);
          db.prepare('DELETE FROM inventory_sessions WHERE id = ?').run(deleteId);
        }
      }
    });
    tx();
    console.log('✅ Cleanup complete');
  }

  // 4) Show final state
  console.log('\n📊 Final state:');
  const finalSessions = db.prepare(`
    SELECT id, remote_uuid, status, COUNT(ic.id) as count_rows
    FROM inventory_sessions is
    LEFT JOIN inventory_counts ic ON ic.session_id = is.id
    GROUP BY is.id
    ORDER BY is.id DESC
  `).all();

  finalSessions.forEach(s => {
    console.log(`  [${s.id}] UUID=${s.remote_uuid || 'NULL'} Status=${s.status} Counts=${s.count_rows}`);
  });

  console.log('\n✅ Cleanup script completed successfully');
} catch (e) {
  console.error('❌ Error:', e.message);
  process.exit(1);
} finally {
  db.close();
}
