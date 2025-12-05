// export_all_tables.js
const { Client } = require('pg');
const fs = require('fs').promises;

async function exportAllTables(config, outDir = './db_export') {
  const client = new Client(config);
  await client.connect();

  await fs.mkdir(outDir, { recursive: true });

  // Liste toutes les tables du schéma public
  const tablesRes = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  for (const { table_name } of tablesRes.rows) {
    const dataRes = await client.query(`SELECT * FROM "${table_name}"`);
    await fs.writeFile(
      `${outDir}/${table_name}.json`,
      JSON.stringify(dataRes.rows, null, 2),
      'utf8'
    );
    console.log(`Exported ${table_name} (${dataRes.rowCount} rows)`);
  }

  await client.end();
}

// Config pour utilisateur "test" et mot de passe "test" sur localhost
const config = {
  user: 'test',
  host: 'localhost',
  database: 'test',
  password: 'test',
  port: 5432,
};

exportAllTables(config).catch(console.error);