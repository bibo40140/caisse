#!/usr/bin/env node
/**
 * Verification script: Check inventory counts structure
 * Run this during an active inventory to verify data integrity
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Find database
const dbDir = path.join(__dirname, 'db');
const dbFiles = fs.readdirSync(dbDir).filter(f => f.endsWith('.db') && !f.includes('backup'));

if (dbFiles.length === 0) {
  console.error('❌ No database file found');
  process.exit(1);
}

const dbPath = path.join(dbDir, dbFiles[0]);
console.log(`📂 Database: ${dbPath}\n`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database error:', err);
    process.exit(1);
  }

  // 1) Check inventory_sessions
  console.log('📊 INVENTORY SESSIONS:');
  db.all(`
    SELECT id, remote_uuid, status, started_at, COUNT(ic.id) as count_rows
    FROM inventory_sessions is
    LEFT JOIN inventory_counts ic ON ic.session_id = is.id
    GROUP BY is.id
    ORDER BY is.id DESC
    LIMIT 10
  `, (err, rows) => {
    if (err) {
      console.error('Error querying sessions:', err);
      return;
    }
    rows.forEach(row => {
      const uuid = row.remote_uuid || 'NULL';
      console.log(`  [ID=${row.id}] UUID=${uuid.slice(0,8)}... Status=${row.status} Counts=${row.count_rows}`);
    });

    // 2) Check for duplicates
    console.log('\n🔍 CHECKING FOR DUPLICATES:');
    db.all(`
      SELECT remote_uuid, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
      FROM inventory_sessions
      WHERE remote_uuid IS NOT NULL
      GROUP BY remote_uuid
      HAVING COUNT(*) > 1
    `, (err, dupes) => {
      if (!dupes || dupes.length === 0) {
        console.log('  ✅ No duplicates found');
      } else {
        console.log(`  ⚠️  Found ${dupes.length} duplicate(s):`);
        dupes.forEach(dup => {
          console.log(`     UUID=${dup.remote_uuid.slice(0,8)}... IDs=[${dup.ids}]`);
        });
      }

      // 3) Recent inventory counts
      console.log('\n📝 RECENT INVENTORY COUNTS (last 20):');
      db.all(`
        SELECT 
          ic.id, 
          ic.session_id, 
          ic.produit_id, 
          ic.qty,
          p.nom,
          is.remote_uuid,
          is.status
        FROM inventory_counts ic
        LEFT JOIN produits p ON p.id = ic.produit_id
        LEFT JOIN inventory_sessions is ON is.id = ic.session_id
        ORDER BY ic.id DESC
        LIMIT 20
      `, (err, counts) => {
        if (err) {
          console.error('Error querying counts:', err);
          db.close();
          return;
        }

        if (counts.length === 0) {
          console.log('  (no counts yet)');
        } else {
          counts.forEach(row => {
            const sessionId = row.session_id || '?';
            const uuid = row.remote_uuid ? row.remote_uuid.slice(0,8) + '...' : 'NULL';
            console.log(`  [${row.id}] Session=${sessionId} (${uuid}) Product=${row.nom} Qty=${row.qty}`);
          });
        }

        console.log('\n✅ Verification complete\n');
        db.close();
      });
    });
  });
});
