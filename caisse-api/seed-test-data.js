/**
 * Script pour créer un tenant de test et des données minimales
 * Usage: node seed-test-data.js
 */

import { pool } from './db/index.js';

const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_EMAIL = 'test@inventory.com';

async function seedTestData() {
  const client = await pool.connect();
  
  try {
    console.log('[SEED] Creation des donnees de test...\n');
    
    await client.query('BEGIN');
    
    // 1) Créer tenant
    console.log('[1/5] Creation du tenant de test...');
    await client.query(
      `INSERT INTO tenants (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [TEST_TENANT_ID, 'Test Association']
    );
    console.log(`      OK Tenant: ${TEST_TENANT_ID}\n`);
    
    // 2) Créer user
    console.log('[2/5] Creation d\'un utilisateur test...');
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [TEST_TENANT_ID, TEST_USER_EMAIL, '$2a$10$dummy', 'admin']
    );
    console.log(`      OK User: ${TEST_USER_EMAIL}\n`);
    
    // 3) Créer catégories et familles
    console.log('[3/5] Creation des referentiels...');
    
    const famille = await client.query(
      `INSERT INTO familles (tenant_id, nom) VALUES ($1, $2)
       ON CONFLICT (tenant_id, nom) DO UPDATE SET nom = EXCLUDED.nom
       RETURNING id`,
      [TEST_TENANT_ID, 'Alimentation']
    );
    const familleId = famille.rows[0].id;
    
    const categorie = await client.query(
      `INSERT INTO categories (tenant_id, famille_id, nom) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, nom) DO UPDATE SET nom = EXCLUDED.nom
       RETURNING id`,
      [TEST_TENANT_ID, familleId, 'Fruits et Legumes']
    );
    const categorieId = categorie.rows[0].id;
    
    const unite = await client.query(
      `INSERT INTO unites (tenant_id, nom) VALUES ($1, $2)
       ON CONFLICT (tenant_id, nom) DO UPDATE SET nom = EXCLUDED.nom
       RETURNING id`,
      [TEST_TENANT_ID, 'kg']
    );
    const uniteId = unite.rows[0].id;
    
    console.log(`      OK Famille: ${familleId}`);
    console.log(`      OK Categorie: ${categorieId}`);
    console.log(`      OK Unite: ${uniteId}\n`);
    
    // 4) Créer produits
    console.log('[4/5] Creation de 10 produits de test...');
    
    const produits = [
      { nom: 'Pommes', prix: 2.5, stock: 50, code_barre: 'POMME001' },
      { nom: 'Bananes', prix: 1.8, stock: 30, code_barre: 'BANANE001' },
      { nom: 'Oranges', prix: 3.2, stock: 40, code_barre: 'ORANGE001' },
      { nom: 'Tomates', prix: 2.8, stock: 25, code_barre: 'TOMATE001' },
      { nom: 'Carottes', prix: 1.5, stock: 60, code_barre: 'CAROTTE001' },
      { nom: 'Courgettes', prix: 2.2, stock: 20, code_barre: 'COURGE001' },
      { nom: 'Salades', prix: 1.2, stock: 15, code_barre: 'SALADE001' },
      { nom: 'Poivrons', prix: 3.5, stock: 18, code_barre: 'POIVRON001' },
      { nom: 'Concombres', prix: 1.9, stock: 22, code_barre: 'CONCOMBRE001' },
      { nom: 'Fraises', prix: 4.5, stock: 12, code_barre: 'FRAISE001' }
    ];
    
    const produitIds = [];
    for (const p of produits) {
      const result = await client.query(
        `INSERT INTO produits (tenant_id, nom, prix, stock, code_barre, unite_id, categorie_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, code_barre) DO UPDATE 
         SET nom = EXCLUDED.nom, prix = EXCLUDED.prix, stock = EXCLUDED.stock
         RETURNING id`,
        [TEST_TENANT_ID, p.nom, p.prix, p.stock, p.code_barre, uniteId, categorieId]
      );
      produitIds.push(result.rows[0].id);
      console.log(`      OK ${p.nom} (stock: ${p.stock})`);
    }
    
    console.log('');
    
    // 5) Créer modes de paiement
    console.log('[5/5] Creation des modes de paiement...');
    
    const modesPaiement = [
      { nom: 'Especes', taux: 0, frais: 0 },
      { nom: 'Carte bancaire', taux: 0, frais: 0 },
      { nom: 'Cheque', taux: 0, frais: 0 }
    ];
    
    for (const mp of modesPaiement) {
      await client.query(
        `INSERT INTO modes_paiement (tenant_id, nom, taux_percent, frais_fixe)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, nom) DO NOTHING`,
        [TEST_TENANT_ID, mp.nom, mp.taux, mp.frais]
      );
      console.log(`      OK ${mp.nom}`);
    }
    
    await client.query('COMMIT');
    
    console.log('\nOK Donnees de test creees avec succes !');
    console.log('\nResume:');
    console.log(`  Tenant ID: ${TEST_TENANT_ID}`);
    console.log(`  User: ${TEST_USER_EMAIL}`);
    console.log(`  Produits: ${produitIds.length}`);
    console.log(`  Total stock initial: ${produits.reduce((sum, p) => sum + p.stock, 0)} unites`);
    
    console.log('\nVous pouvez maintenant lancer les tests:');
    console.log('  npm test inventory.test.js');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nERREUR:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seedTestData()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
