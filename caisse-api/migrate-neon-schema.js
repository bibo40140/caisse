// migrate-neon-schema.js
// Script Node.js pour appliquer la migration PostgreSQL/Neon de manière sécurisée
// Usage: node migrate-neon-schema.js

import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runNeonMigration() {
  console.log(`\n====================================`);
  console.log(`Migration du schéma PostgreSQL/Neon`);
  console.log(`====================================\n`);

  if (!process.env.DATABASE_URL) {
    console.error(`❌ Erreur: DATABASE_URL manquant dans .env`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    // Lire le script SQL
    const sqlScript = fs.readFileSync(
      path.join(__dirname, 'sql', 'migrate-neon-schema.sql'),
      'utf8'
    );

    console.log(`📝 Exécution du script de migration...\n`);

    // Exécuter le script complet
    await client.query(sqlScript);

    console.log(`✅ Migration Neon terminée avec succès !\n`);

    // Vérifications finales
    console.log(`🔍 Vérification des colonnes ajoutées...\n`);

    const result = await client.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('produits', 'ventes', 'lignes_vente', 'receptions', 'lignes_reception', 'adherents', 'fournisseurs', 'inventory_counts')
        AND column_name IN ('created_at', 'updated_at', 'statut')
      ORDER BY table_name, column_name
    `);

    console.log(`📋 Colonnes created_at/updated_at présentes:\n`);
    result.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}.${row.column_name} (${row.data_type})`);
    });

    // Vérifier les index
    console.log(`\n🔍 Vérification des index créés...\n`);

    const indexes = await client.query(`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE tablename IN ('produits', 'ventes', 'lignes_vente', 'receptions', 'lignes_reception', 'adherents', 'fournisseurs', 'inventory_counts')
        AND (indexname LIKE '%created_at%' OR indexname LIKE '%updated_at%')
      ORDER BY tablename, indexname
    `);

    console.log(`📋 Index créés (${indexes.rows.length}):\n`);
    indexes.rows.forEach(row => {
      console.log(`   ✅ ${row.tablename}.${row.indexname}`);
    });

    // Vérifier les triggers
    console.log(`\n🔍 Vérification des triggers updated_at...\n`);

    const triggers = await client.query(`
      SELECT 
        event_object_table AS table_name,
        trigger_name
      FROM information_schema.triggers
      WHERE trigger_name LIKE '%updated%'
      ORDER BY event_object_table, trigger_name
    `);

    console.log(`📋 Triggers présents (${triggers.rows.length}):\n`);
    triggers.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}: ${row.trigger_name}`);
    });

    console.log(`\n====================================`);
    console.log(`✅ Migration Neon terminée !`);
    console.log(`====================================\n`);

  } catch (err) {
    console.error(`\n❌ Erreur lors de la migration:`, err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Point d'entrée
runNeonMigration();
