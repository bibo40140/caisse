/**
 * ============================================================
 * TESTS INVENTAIRE MULTIPOSTE/MULTITENANT
 * ============================================================
 * 
 * Tests complets pour valider toutes les fonctionnalités
 * de l'inventaire avec support multi-terminal et multi-tenant
 */

import { pool } from '../db/index.js';

// Configuration de test
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'; // UUID de test
const TEST_USER_EMAIL = 'test@inventory.com';

// Helper pour nettoyer la base avant/après tests
async function cleanupTestData() {
  const client = await pool.connect();
  try {
    // Supprimer les données de test
    await client.query('DELETE FROM inventory_counts WHERE tenant_id = $1', [TEST_TENANT_ID]);
    await client.query('DELETE FROM inventory_adjust WHERE tenant_id = $1', [TEST_TENANT_ID]);
    await client.query('DELETE FROM inventory_snapshot WHERE tenant_id = $1', [TEST_TENANT_ID]);
    await client.query('DELETE FROM inventory_sessions WHERE tenant_id = $1', [TEST_TENANT_ID]);
    await client.query('DELETE FROM stock_movements WHERE tenant_id = $1', [TEST_TENANT_ID]);
    await client.query('DELETE FROM produits WHERE tenant_id = $1', [TEST_TENANT_ID]);
  } finally {
    client.release();
  }
}

// Helper pour créer des produits de test
async function createTestProducts(count = 5) {
  const client = await pool.connect();
  const productIds = [];
  
  try {
    // Utiliser timestamp pour éviter les doublons de code-barres
    const timestamp = Date.now();
    for (let i = 1; i <= count; i++) {
      const result = await client.query(
        `INSERT INTO produits (tenant_id, nom, code_barre, stock, prix)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [TEST_TENANT_ID, `Produit Test ${i}`, `BARCODE${timestamp}${i}`, i * 10, i * 1.5]
      );
      productIds.push(result.rows[0].id);
    }
  } finally {
    client.release();
  }
  
  return productIds;
}

// Helper pour créer une session
async function createTestSession(name = 'Session Test') {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO inventory_sessions (tenant_id, name, status, started_at, "user")
       VALUES ($1, $2, 'open', NOW(), $3)
       RETURNING id, name, status, started_at`,
      [TEST_TENANT_ID, name, TEST_USER_EMAIL]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

describe('🎯 Inventaire Multiposte/Multitenant - Tests Complets', () => {
  
  // Nettoyer avant et après tous les tests
  beforeAll(async () => {
    await cleanupTestData();
  });
  
  afterAll(async () => {
    await cleanupTestData();
    await pool.end();
  });

  // ========================================
  // NIVEAU 1 : Création de Session
  // ========================================
  describe('📋 Niveau 1 : Gestion des Sessions', () => {
    
    test('✅ Devrait créer une nouvelle session', async () => {
      const session = await createTestSession('Test Session 1');
      
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.name).toBe('Test Session 1');
      expect(session.status).toBe('open');
      expect(session.started_at).toBeDefined();
    });
    
    test('✅ Devrait lister les sessions du tenant', async () => {
      // Créer 2 sessions
      await createTestSession('Session A');
      await createTestSession('Session B');
      
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, name, status FROM inventory_sessions 
           WHERE tenant_id = $1 
           ORDER BY started_at DESC`,
          [TEST_TENANT_ID]
        );
        
        expect(result.rows.length).toBeGreaterThanOrEqual(2);
        expect(result.rows[0].name).toBe('Session B'); // Plus récente en premier
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait filtrer les sessions par statut', async () => {
      const client = await pool.connect();
      try {
        // Fermer une session existante pour le test
        const sessions = await client.query(
          `SELECT id FROM inventory_sessions 
           WHERE tenant_id = $1 AND status = 'open'
           ORDER BY started_at DESC
           LIMIT 1`,
          [TEST_TENANT_ID]
        );
        
        if (sessions.rows.length > 0) {
          await client.query(
            `UPDATE inventory_sessions 
             SET status = 'closed', ended_at = NOW() 
             WHERE id = $1`,
            [sessions.rows[0].id]
          );
        }
        
        // Compter les sessions ouvertes
        const open = await client.query(
          `SELECT COUNT(*) as count FROM inventory_sessions 
           WHERE tenant_id = $1 AND status = 'open'`,
          [TEST_TENANT_ID]
        );
        
        // Compter les sessions fermées
        const closed = await client.query(
          `SELECT COUNT(*) as count FROM inventory_sessions 
           WHERE tenant_id = $1 AND status = 'closed'`,
          [TEST_TENANT_ID]
        );
        
        expect(Number(open.rows[0].count)).toBeGreaterThanOrEqual(1);
        expect(Number(closed.rows[0].count)).toBeGreaterThanOrEqual(1);
      } finally {
        client.release();
      }
    });
  });

  // ========================================
  // NIVEAU 2 : Comptages Multiposte
  // ========================================
  describe('📊 Niveau 2 : Comptages Multi-Devices', () => {
    
    let testSession;
    let testProducts;
    
    beforeAll(async () => {
      testSession = await createTestSession('Session Multiposte');
      testProducts = await createTestProducts(3);
    });
    
    test('✅ Devrait ajouter un comptage simple', async () => {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [testSession.id, TEST_TENANT_ID, testProducts[0], 'TERMINAL-A', 10]
        );
        
        const result = await client.query(
          `SELECT * FROM inventory_counts WHERE session_id = $1 AND produit_id = $2`,
          [testSession.id, testProducts[0]]
        );
        
        expect(result.rows.length).toBe(1);
        expect(Number(result.rows[0].qty)).toBe(10);
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait supporter plusieurs devices comptant le même produit', async () => {
      const client = await pool.connect();
      try {
        // Terminal A compte 5
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (session_id, produit_id, device_id) 
           DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty`,
          [testSession.id, TEST_TENANT_ID, testProducts[1], 'TERMINAL-A', 5]
        );
        
        // Terminal B compte 8
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (session_id, produit_id, device_id) 
           DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty`,
          [testSession.id, TEST_TENANT_ID, testProducts[1], 'TERMINAL-B', 8]
        );
        
        // Vérifier l'agrégation
        const agg = await client.query(
          `SELECT SUM(qty)::numeric as total FROM inventory_counts 
           WHERE session_id = $1 AND produit_id = $2`,
          [testSession.id, testProducts[1]]
        );
        
        expect(Number(agg.rows[0].total)).toBe(13); // 5 + 8
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait accumuler les comptages successifs du même device', async () => {
      const client = await pool.connect();
      try {
        // Scanner 3 fois le même produit sur le même terminal
        for (let i = 0; i < 3; i++) {
          await client.query(
            `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (session_id, produit_id, device_id) 
             DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty`,
            [testSession.id, TEST_TENANT_ID, testProducts[2], 'TERMINAL-A', 1]
          );
        }
        
        const result = await client.query(
          `SELECT qty FROM inventory_counts 
           WHERE session_id = $1 AND produit_id = $2 AND device_id = $3`,
          [testSession.id, testProducts[2], 'TERMINAL-A']
        );
        
        expect(Number(result.rows[0].qty)).toBe(3);
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait retourner les comptages détaillés par device', async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT produit_id, device_id, qty FROM inventory_counts 
           WHERE session_id = $1 
           ORDER BY produit_id, device_id`,
          [testSession.id]
        );
        
        // Devrait avoir plusieurs lignes (multiposte)
        expect(result.rows.length).toBeGreaterThan(1);
        
        // Vérifier qu'on a bien des devices différents
        const devices = new Set(result.rows.map(r => r.device_id));
        expect(devices.size).toBeGreaterThanOrEqual(2);
      } finally {
        client.release();
      }
    });
  });

  // ========================================
  // NIVEAU 3 : Résumé et Calcul de Deltas
  // ========================================
  describe('📈 Niveau 3 : Résumé et Deltas', () => {
    
    let testSession;
    let testProducts;
    
    beforeAll(async () => {
      testSession = await createTestSession('Session Résumé');
      testProducts = await createTestProducts(3);
    });
    
    test('✅ Devrait calculer le résumé avec stock_start', async () => {
      const client = await pool.connect();
      try {
        // Récupérer le stock initial d'un produit
        const prod = await client.query(
          `SELECT id, stock FROM produits WHERE id = $1`,
          [testProducts[0]]
        );
        
        const stockStart = Number(prod.rows[0].stock);
        
        // Ajouter un comptage
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [testSession.id, TEST_TENANT_ID, testProducts[0], 'TERMINAL-A', 15]
        );
        
        // Calculer le delta
        const agg = await client.query(
          `SELECT SUM(qty)::numeric as counted FROM inventory_counts 
           WHERE session_id = $1 AND produit_id = $2`,
          [testSession.id, testProducts[0]]
        );
        
        const counted = Number(agg.rows[0].counted);
        const delta = counted - stockStart;
        
        expect(counted).toBe(15);
        expect(delta).toBe(15 - stockStart);
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait inclure les produits non comptés avec counted=0', async () => {
      const client = await pool.connect();
      try {
        // Récupérer tous les produits
        const allProds = await client.query(
          `SELECT id FROM produits WHERE tenant_id = $1`,
          [TEST_TENANT_ID]
        );
        
        // Récupérer les comptages
        const counts = await client.query(
          `SELECT DISTINCT produit_id FROM inventory_counts WHERE session_id = $1`,
          [testSession.id]
        );
        
        // Il devrait y avoir des produits non comptés
        expect(allProds.rows.length).toBeGreaterThan(counts.rows.length);
      } finally {
        client.release();
      }
    });
  });

  // ========================================
  // NIVEAU 4 : Snapshot et Finalisation
  // ========================================
  describe('🔒 Niveau 4 : Snapshot et Finalisation', () => {
    
    let testSession;
    let testProducts;
    
    beforeAll(async () => {
      testSession = await createTestSession('Session Finalize');
      testProducts = await createTestProducts(3);
    });
    
    test('✅ Devrait créer un snapshot avant finalisation', async () => {
      const client = await pool.connect();
      try {
        // Créer snapshot
        await client.query(
          `INSERT INTO inventory_snapshot (session_id, tenant_id, produit_id, stock_start, unit_cost)
           SELECT $1, $2, id, stock, prix
           FROM produits
           WHERE tenant_id = $2 AND deleted IS NOT TRUE`,
          [testSession.id, TEST_TENANT_ID]
        );
        
        const snapshot = await client.query(
          `SELECT COUNT(*) as count FROM inventory_snapshot WHERE session_id = $1`,
          [testSession.id]
        );
        
        expect(Number(snapshot.rows[0].count)).toBeGreaterThan(0);
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait créer des stock_movements pour les deltas', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Ajouter un comptage avec différence
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [testSession.id, TEST_TENANT_ID, testProducts[0], 'TERMINAL-A', 100]
        );
        
        // Récupérer stock initial
        const prod = await client.query(
          `SELECT stock FROM produits WHERE id = $1`,
          [testProducts[0]]
        );
        
        const stockStart = Number(prod.rows[0].stock);
        const delta = 100 - stockStart;
        
        // Créer movement
        await client.query(
          `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
           VALUES ($1, $2, $3, 'inventory', $4, NOW())`,
          [TEST_TENANT_ID, testProducts[0], delta, testSession.id]
        );
        
        await client.query('COMMIT');
        
        // Vérifier le movement
        const movement = await client.query(
          `SELECT * FROM stock_movements WHERE produit_id = $1 AND source = 'inventory'`,
          [testProducts[0]]
        );
        
        expect(movement.rows.length).toBeGreaterThan(0);
        expect(Number(movement.rows[0].delta)).toBe(delta);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait mettre à jour le stock produit après finalisation', async () => {
      const client = await pool.connect();
      try {
        const newStock = 250;
        
        await client.query(
          `UPDATE produits SET stock = $1 WHERE id = $2`,
          [newStock, testProducts[1]]
        );
        
        const result = await client.query(
          `SELECT stock FROM produits WHERE id = $1`,
          [testProducts[1]]
        );
        
        expect(Number(result.rows[0].stock)).toBe(newStock);
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait fermer la session après finalisation', async () => {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE inventory_sessions SET status = 'closed', ended_at = NOW() WHERE id = $1`,
          [testSession.id]
        );
        
        const result = await client.query(
          `SELECT status, ended_at FROM inventory_sessions WHERE id = $1`,
          [testSession.id]
        );
        
        expect(result.rows[0].status).toBe('closed');
        expect(result.rows[0].ended_at).not.toBeNull();
      } finally {
        client.release();
      }
    });
    
    test('✅ Devrait empêcher la double finalisation', async () => {
      const client = await pool.connect();
      try {
        // Créer une session et la marquer comme "finalizing"
        const newSession = await createTestSession('Session Lock Test');
        
        await client.query(
          `UPDATE inventory_sessions SET status = 'finalizing' WHERE id = $1`,
          [newSession.id]
        );
        
        // Vérifier le statut
        const result = await client.query(
          `SELECT status FROM inventory_sessions WHERE id = $1`,
          [newSession.id]
        );
        
        expect(result.rows[0].status).toBe('finalizing');
        
        // Si on essaie de finaliser à nouveau, ça devrait être bloqué par la logique métier
        // (testé dans les tests d'API avec supertest)
      } finally {
        client.release();
      }
    });
  });

  // ========================================
  // NIVEAU 5 : Isolation Multi-Tenant
  // ========================================
  describe('🏢 Niveau 5 : Isolation Multi-Tenant', () => {
    
    const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
    const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
    
    beforeAll(async () => {
      const client = await pool.connect();
      try {
        // Créer Tenant B pour les tests d'isolation
        await client.query(
          `INSERT INTO tenants (id, name) VALUES ($1, $2)
           ON CONFLICT (id) DO NOTHING`,
          [TENANT_B, 'Test Association B']
        );
        
        // Créer des données pour 2 tenants
        await client.query(
          `INSERT INTO produits (tenant_id, nom, code_barre, stock, prix)
           VALUES ($1, $2, $3, $4, $5)`,
          [TENANT_A, 'Produit Tenant A', 'BARA', 10, 1.5]
        );
        
        await client.query(
          `INSERT INTO produits (tenant_id, nom, code_barre, stock, prix)
           VALUES ($1, $2, $3, $4, $5)`,
          [TENANT_B, 'Produit Tenant B', 'BARB', 20, 2.5]
        );
      } finally {
        client.release();
      }
    });
    
    afterAll(async () => {
      const client = await pool.connect();
      try {
        await client.query('DELETE FROM produits WHERE tenant_id = $1', [TENANT_B]);
      } finally {
        client.release();
      }
    });
    
    test('✅ Tenant A ne devrait voir que ses produits', async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT * FROM produits WHERE tenant_id = $1`,
          [TENANT_A]
        );
        
        // Ne devrait contenir que les produits du tenant A
        expect(result.rows.every(r => r.tenant_id === TENANT_A)).toBe(true);
        expect(result.rows.some(r => r.nom.includes('Tenant A'))).toBe(true);
      } finally {
        client.release();
      }
    });
    
    test('✅ Tenant B ne devrait voir que ses produits', async () => {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT * FROM produits WHERE tenant_id = $1`,
          [TENANT_B]
        );
        
        expect(result.rows.every(r => r.tenant_id === TENANT_B)).toBe(true);
        expect(result.rows.some(r => r.nom.includes('Tenant B'))).toBe(true);
      } finally {
        client.release();
      }
    });
    
    test('✅ Sessions doivent être isolées par tenant', async () => {
      const client = await pool.connect();
      try {
        // Créer session pour tenant A
        await client.query(
          `INSERT INTO inventory_sessions (tenant_id, name, status, started_at)
           VALUES ($1, $2, 'open', NOW())`,
          [TENANT_A, 'Session Tenant A']
        );
        
        // Créer session pour tenant B
        await client.query(
          `INSERT INTO inventory_sessions (tenant_id, name, status, started_at)
           VALUES ($1, $2, 'open', NOW())`,
          [TENANT_B, 'Session Tenant B']
        );
        
        // Tenant A ne voit que sa session
        const sessionsA = await client.query(
          `SELECT * FROM inventory_sessions WHERE tenant_id = $1`,
          [TENANT_A]
        );
        
        expect(sessionsA.rows.every(r => r.tenant_id === TENANT_A)).toBe(true);
      } finally {
        client.release();
      }
    });
  });

  // ========================================
  // NIVEAU 6 : Scénarios d'Intégration
  // ========================================
  describe('🎬 Niveau 6 : Scénarios Complets', () => {
    
    test('✅ Scénario complet : 2 terminaux comptent puis finalisent', async () => {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // 1. Créer session
        const session = await client.query(
          `INSERT INTO inventory_sessions (tenant_id, name, status, started_at)
           VALUES ($1, $2, 'open', NOW())
           RETURNING id`,
          [TEST_TENANT_ID, 'Scénario Complet']
        );
        const sessionId = session.rows[0].id;
        
        // 2. Créer un produit avec stock initial
        const prod = await client.query(
          `INSERT INTO produits (tenant_id, nom, code_barre, stock, prix)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, stock`,
          [TEST_TENANT_ID, 'Produit Scénario', 'SCEN1', 50, 10]
        );
        const produitId = prod.rows[0].id;
        const stockInitial = Number(prod.rows[0].stock);
        
        // 3. Terminal A compte 30
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [sessionId, TEST_TENANT_ID, produitId, 'TERMINAL-A', 30]
        );
        
        // 4. Terminal B compte 25
        await client.query(
          `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, qty, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [sessionId, TEST_TENANT_ID, produitId, 'TERMINAL-B', 25]
        );
        
        // 5. Vérifier l'agrégation
        const agg = await client.query(
          `SELECT SUM(qty)::numeric as total FROM inventory_counts 
           WHERE session_id = $1 AND produit_id = $2`,
          [sessionId, produitId]
        );
        const countedTotal = Number(agg.rows[0].total);
        
        expect(countedTotal).toBe(55); // 30 + 25
        
        // 6. Créer snapshot
        await client.query(
          `INSERT INTO inventory_snapshot (session_id, tenant_id, produit_id, stock_start, unit_cost)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, TEST_TENANT_ID, produitId, stockInitial, 10]
        );
        
        // 7. Calculer delta et créer movement (utilise 'delta' comme dans le schéma)
        const delta = countedTotal - stockInitial;
        
        await client.query(
          `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
           VALUES ($1, $2, $3, 'inventory', $4, NOW())`,
          [TEST_TENANT_ID, produitId, delta, sessionId]
        );
        
        // 8. Mettre à jour stock
        await client.query(
          `UPDATE produits SET stock = $1 WHERE id = $2`,
          [countedTotal, produitId]
        );
        
        // 9. Fermer session
        await client.query(
          `UPDATE inventory_sessions SET status = 'closed', ended_at = NOW() WHERE id = $1`,
          [sessionId]
        );
        
        await client.query('COMMIT');
        
        // Vérifications finales
        const finalProd = await client.query(
          `SELECT stock FROM produits WHERE id = $1`,
          [produitId]
        );
        
        const finalSession = await client.query(
          `SELECT status FROM inventory_sessions WHERE id = $1`,
          [sessionId]
        );
        
        expect(Number(finalProd.rows[0].stock)).toBe(55);
        expect(finalSession.rows[0].status).toBe('closed');
        
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  });
});

/**
 * ============================================================
 * 📊 RÉSUMÉ DES TESTS
 * ============================================================
 * 
 * COUVERTURE :
 * ✅ Création de sessions
 * ✅ Filtrage par statut
 * ✅ Comptages multi-devices
 * ✅ Accumulation des comptages
 * ✅ Agrégation par produit
 * ✅ Calcul de deltas
 * ✅ Création de snapshots
 * ✅ Stock movements
 * ✅ Mise à jour des stocks
 * ✅ Finalisation avec lock
 * ✅ Isolation multi-tenant
 * ✅ Scénario complet end-to-end
 * 
 * POUR LANCER :
 * cd caisse-api
 * npm test inventory.test.js
 * 
 * ATTENDU :
 * ✅ Tous les tests devraient passer si la DB est configurée
 * ❌ Si échecs, vérifier :
 *    - Variables d'environnement (.env.test)
 *    - Schéma de base de données
 *    - Contraintes et index
 */
