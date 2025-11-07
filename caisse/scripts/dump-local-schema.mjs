// scripts/dump-local-schema.mjs
import db from '../src/main/db/db.js';

function listTables() {
  const rows = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name"
  ).all();
  console.log('=== sqlite_master (tables & indexes) ===');
  for (const r of rows) {
    console.log('\n--', r.name, '\n', r.sql);
  }
}

function tableInfo(table) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    console.log(`\n=== PRAGMA table_info(${table}) ===`);
    console.table(cols);
  } catch (e) {
    console.log(`\n(PRAGMA ${table}):`, e.message);
  }
}

function quickChecks() {
  const checks = [
    ["produits", "SELECT COUNT(*) AS no_remote FROM produits WHERE COALESCE(remote_uuid,'')=''"],
    ["stock_movements", "SELECT COUNT(*) AS rows_sm FROM stock_movements"],
  ];
  for (const [name, sql] of checks) {
    try {
      const row = db.prepare(sql).get();
      console.log(`\n[check] ${name}:`, row);
    } catch (e) {
      console.log(`\n[check] ${name} ERROR:`, e.message);
    }
  }
}

listTables();
["unites","familles","categories","fournisseurs","adherents","modes_paiement",
 "produits","receptions","lignes_reception","ventes","lignes_vente","stock_movements",
 "inventory_sessions","inventory_counts"].forEach(tableInfo);

quickChecks();
