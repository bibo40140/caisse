// export_all_tables.cjs (SQLite version)
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

async function exportAllTablesSqlite(dbPath, outDir = './db_export_sqlite') {
  const db = new sqlite3.Database(dbPath);
  await fs.mkdir(outDir, { recursive: true });

  // Liste toutes les tables
  const tables = await new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.name));
    });
  });

  for (const table of tables) {
    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM "${table}"`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    await fs.writeFile(
      path.join(outDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8'
    );
    console.log(`Exported ${table} (${rows.length} rows)`);
  }
  db.close();
}

// Chemin vers la base SQLite locale (corrigé)
const dbPath = path.resolve(__dirname, '../caisse/db/tenant_59bef0ac-a444-4301-902a-581e7a0231c8.db');
exportAllTablesSqlite(dbPath).catch(console.error);