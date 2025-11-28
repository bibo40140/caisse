/**
 * Script pour créer les tables d'inventaire dans Neon
 * Usage: node create-inventory-schema.js
 */

import { pool } from './db/index.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createInventorySchema() {
  const client = await pool.connect();
  
  try {
    console.log('[setup] Creation des tables d\'inventaire...\n');
    
    // Activer l'extension UUID si pas déjà fait
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('Extension UUID activee\n');
    
    await client.query('BEGIN');
    
    // 1) Inventaire Sessions
    console.log('[1/4] Creation de inventory_sessions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_sessions (
        id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id  uuid        NOT NULL,
        name       text        NOT NULL,
        "user"     text,
        notes      text,
        status     text        NOT NULL DEFAULT 'open',
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at   timestamptz
      )
    `);
    console.log('   OK inventory_sessions creee');
    
    // 2) Inventaire Snapshot
    console.log('[2/4] Creation de inventory_snapshot...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_snapshot (
        session_id  uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
        tenant_id   uuid        NOT NULL,
        produit_id  uuid        NOT NULL,
        stock_start numeric(14,3),
        unit_cost   numeric(12,2),
        PRIMARY KEY (session_id, produit_id)
      )
    `);
    console.log('   OK inventory_snapshot creee');
    
    // 3) Inventaire Counts
    console.log('[3/4] Creation de inventory_counts...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_counts (
        session_id uuid         NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
        tenant_id  uuid         NOT NULL,
        produit_id uuid         NOT NULL,
        device_id  text         NOT NULL,
        "user"     text,
        qty        numeric(14,3) NOT NULL,
        updated_at timestamptz   NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, produit_id, device_id)
      )
    `);
    console.log('   OK inventory_counts creee');
    
    // 4) Inventaire Adjust
    console.log('[4/4] Creation de inventory_adjust...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_adjust (
        session_id    uuid        NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
        tenant_id     uuid        NOT NULL,
        produit_id    uuid        NOT NULL,
        stock_start   numeric(14,3),
        counted_total numeric(14,3),
        delta         numeric(14,3),
        unit_cost     numeric(12,2),
        delta_value   numeric(14,3),
        created_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, tenant_id, produit_id)
      )
    `);
    console.log('   OK inventory_adjust creee');
    
    // 5) Index
    console.log('\n[INDEX] Création des index...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_inv_sessions_tenant ON inventory_sessions(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_sessions_status ON inventory_sessions(status)',
      'CREATE INDEX IF NOT EXISTS idx_inv_snapshot_tenant ON inventory_snapshot(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_snapshot_produit ON inventory_snapshot(produit_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_counts_tenant ON inventory_counts(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_counts_produit ON inventory_counts(produit_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_counts_device ON inventory_counts(device_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_adjust_tenant ON inventory_adjust(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_inv_adjust_produit ON inventory_adjust(produit_id)',
    ];
    
    for (const idx of indexes) {
      await client.query(idx);
    }
    console.log(`   ✅ ${indexes.length} index créés`);
    
    await client.query('COMMIT');
    
    // Vérification
    console.log('\n[VERIFICATION] Comptage des tables...');
    const result = await client.query(`
      SELECT 'inventory_sessions' as table_name, COUNT(*) as count FROM inventory_sessions
      UNION ALL
      SELECT 'inventory_snapshot', COUNT(*) FROM inventory_snapshot
      UNION ALL
      SELECT 'inventory_counts', COUNT(*) FROM inventory_counts
      UNION ALL
      SELECT 'inventory_adjust', COUNT(*) FROM inventory_adjust
    `);
    
    console.log('\nEtat des tables:');
    result.rows.forEach(row => {
      console.log(`   ${row.table_name}: ${row.count} lignes`);
    });
    
    console.log('\nOK Schema d\'inventaire cree avec succes !');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nERREUR lors de la creation du schema:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

// Lancer le script
createInventorySchema()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
