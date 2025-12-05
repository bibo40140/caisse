// export_all_tables_neon.cjs (PostgreSQL/Neon version)
const { Client } = require('pg');
const fs = require('fs').promises;
const path = require('path');

async function exportAllTablesPg(config, outDir = './db_export_neon') {
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
      path.join(outDir, `${table_name}.json`),
      JSON.stringify(dataRes.rows, null, 2),
      'utf8'
    );
    console.log(`Exported ${table_name} (${dataRes.rowCount} rows)`);
  }
  await client.end();
}

// Config Neon (adapter si besoin)
const config = {
  user: 'neondb_owner',
  host: 'ep-lingering-mountain-abdp5q7l-pooler.eu-west-2.aws.neon.tech',
  database: 'neondb',
  password: 'npg_U5gbMSBwVL8A',
  port: 5432,
  ssl: { rejectUnauthorized: false },
};

exportAllTablesPg(config).catch(console.error);
