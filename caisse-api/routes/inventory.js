// caisse-api/routes/inventory.js - Version complète multiposte/multitenant avec UUIDs
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /inventory/start
 * body: { name?, user?, notes? }
 * Crée une session d'inventaire "open" pour le tenant courant.
 * Retourne un UUID de session.
 */
router.post('/inventory/start', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id manquant' });

  const { name, user = null, notes = null } = req.body || {};
  const label = name && String(name).trim()
    ? String(name).trim()
    : `Inventaire ${new Date().toISOString().slice(0, 10)}`;

  try {
    // Vérifier si une session "open" existe déjà
    const existing = await pool.query(
      `SELECT id, tenant_id, name, status, started_at, "user" as started_by, notes
       FROM inventory_sessions
       WHERE tenant_id = $1 AND status = 'open'
       ORDER BY started_at DESC
       LIMIT 1`,
      [tenantId]
    );

    if (existing.rows.length > 0) {
      // Réutiliser la session existante
      return res.json({ ok: true, session: existing.rows[0], reused: true });
    }

    // Créer nouvelle session
    const result = await pool.query(
      `INSERT INTO inventory_sessions
         (tenant_id, name, status, started_at, "user", notes)
       VALUES
         ($1, $2, 'open', NOW(), $3, $4)
       RETURNING id, tenant_id, name, status, started_at, "user" as started_by, notes`,
      [tenantId, label, user, notes]
    );

    return res.json({ ok: true, session: result.rows[0], reused: false });
  } catch (e) {
    console.error('[POST /inventory/start] error:', e);
    return res.status(500).json({ error: 'inventory start failed', details: e.message });
  }
});

/**
 * GET /inventory/sessions
 * Query params: ?status=open|closed|all (default: all)
 * Liste les sessions d'inventaire pour le tenant courant.
 */
router.get('/inventory/sessions', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id manquant' });

  const status = req.query?.status || 'all';

  try {
    let query = `
      SELECT id, tenant_id, name, status, started_at, ended_at, "user", notes
      FROM inventory_sessions
      WHERE tenant_id = $1
    `;
    const params = [tenantId];

    if (status !== 'all') {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY started_at DESC LIMIT 50`;

    const result = await pool.query(query, params);

    return res.json({ ok: true, sessions: result.rows });
  } catch (e) {
    console.error('[GET /inventory/sessions] error:', e);
    return res.status(500).json({ error: 'failed to fetch sessions', details: e.message });
  }
});

/**
 * POST /inventory/:sessionId/count-add
 * body: { product_id (uuid), qty (numeric), user?, device_id? }
 * Ajoute un comptage pour un produit dans une session.
 * Supporte plusieurs comptages du même produit (agrégation par device).
 */
router.post('/inventory/:sessionId/count-add', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;
  const { product_id: produit_id, qty, user = null, device_id = null } = req.body || {};

  if (!tenantId || !sessionId || !produit_id || !Number.isFinite(Number(qty))) {
    return res.status(400).json({ error: 'champs requis: sessionId, product_id, qty' });
  }

  const deviceIdFinal = device_id || req.headers['x-device-id'] || 'unknown';

  try {
    // Upsert: si déjà un comptage pour cette combinaison session/produit/device, on accumule
    await pool.query(
      `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, "user", qty, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (session_id, produit_id, device_id)
       DO UPDATE SET
         qty = inventory_counts.qty + EXCLUDED.qty,
         "user" = COALESCE(EXCLUDED."user", inventory_counts."user"),
         updated_at = NOW()`,
      [sessionId, tenantId, produit_id, deviceIdFinal, user, Number(qty)]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /inventory/:sessionId/count-add] error:', e);
    return res.status(500).json({ error: 'count-add failed', details: e.message });
  }
});

/**
 * GET /inventory/:sessionId/summary
 * Retourne un résumé de l'inventaire avec:
 * - stock_start (avant inventaire)
 * - counted_total (agrégé tous devices)
 * - delta (counted - stock_start)
 * Pour tous les produits du tenant (y compris ceux non comptés = 0)
 */
router.get('/inventory/:sessionId/summary', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;

  if (!tenantId || !sessionId) {
    return res.status(400).json({ error: 'sessionId requis' });
  }

  try {
    // Récupérer snapshot de stock au début de l'inventaire (si existe)
    const snapshot = await pool.query(
      `SELECT produit_id, stock_start, unit_cost
       FROM inventory_snapshot
       WHERE session_id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );

    const snapshotMap = new Map();
    snapshot.rows.forEach(row => {
      snapshotMap.set(row.produit_id, {
        stock_start: Number(row.stock_start || 0),
        unit_cost: Number(row.unit_cost || 0)
      });
    });

    // Récupérer comptages agrégés par produit (tous devices)
    const counts = await pool.query(
      `SELECT produit_id, SUM(qty)::numeric AS counted_total
       FROM inventory_counts
       WHERE session_id = $1 AND tenant_id = $2
       GROUP BY produit_id`,
      [sessionId, tenantId]
    );

    const countsMap = new Map();
    counts.rows.forEach(row => {
      countsMap.set(row.produit_id, Number(row.counted_total || 0));
    });

    // Récupérer tous les produits du tenant avec infos de base
    const produits = await pool.query(
      `SELECT id, nom, code_barre, code_barres, stock, prix
       FROM produits
       WHERE tenant_id = $1 AND deleted IS NOT TRUE
       ORDER BY nom`,
      [tenantId]
    );

    // Construire les lignes de résumé
    const lines = produits.rows.map(p => {
      const snp = snapshotMap.get(p.id) || { stock_start: Number(p.stock || 0), unit_cost: Number(p.prix || 0) };
      const counted = countsMap.get(p.id) || 0;
      const delta = counted - snp.stock_start;

      return {
        product_id: p.id,
        remote_product_id: p.id, // Pour compat avec handler Electron
        remote_id: p.id,
        nom: p.nom,
        barcode: p.code_barre || p.code_barres || '',
        code_barres: p.code_barre || p.code_barres || '',
        stock_start: snp.stock_start,
        counted_total: counted,
        delta: delta,
        prix: Number(p.prix || 0),
        price: Number(p.prix || 0),
        unit_cost: snp.unit_cost
      };
    });

    return res.json({
      ok: true,
      sessionId: sessionId,
      lines: lines,
      total_products: lines.length,
      counted_products: lines.filter(l => l.counted_total > 0).length
    });
  } catch (e) {
    console.error('[GET /inventory/:sessionId/summary] error:', e);
    return res.status(500).json({ error: 'summary failed', details: e.message });
  }
});

/**
 * POST /inventory/:sessionId/finalize
 * body: { user?, email_to? }
 * Finalise l'inventaire:
 * 1. Crée snapshot si n'existe pas
 * 2. Agrège comptages
 * 3. Calcule deltas et crée stock_movements
 * 4. Met à jour les stocks produits
 * 5. Ferme la session
 */
router.post('/inventory/:sessionId/finalize', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;
  const { user = null, email_to = null } = req.body || {};

  if (!tenantId || !sessionId) {
    return res.status(400).json({ error: 'sessionId requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Vérifier si déjà finalisé
    const session = await client.query(
      `SELECT status FROM inventory_sessions WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );

    if (!session.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'session not found' });
    }

    if (session.rows[0].status === 'closed' || session.rows[0].status === 'finalizing') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'session_locked', message: 'Session already finalized' });
    }

    // Marquer comme "finalizing" pour éviter doubles finalisations
    await client.query(
      `UPDATE inventory_sessions SET status = 'finalizing' WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );

    // 1) Créer snapshot si n'existe pas (stock au moment de la finalisation)
    const snapshotExists = await client.query(
      `SELECT COUNT(*) as cnt FROM inventory_snapshot WHERE session_id = $1`,
      [sessionId]
    );

    if (Number(snapshotExists.rows[0].cnt) === 0) {
      await client.query(
        `INSERT INTO inventory_snapshot (session_id, tenant_id, produit_id, stock_start, unit_cost)
         SELECT $1, $2, id, stock, prix
         FROM produits
         WHERE tenant_id = $2 AND deleted IS NOT TRUE`,
        [sessionId, tenantId]
      );
    }

    // 2) Agrégat des comptages
    const agg = await client.query(
      `SELECT produit_id, SUM(qty)::numeric AS counted_total
       FROM inventory_counts
       WHERE tenant_id = $1 AND session_id = $2
       GROUP BY produit_id`,
      [tenantId, sessionId]
    );

    const countsMap = new Map();
    agg.rows.forEach(row => {
      countsMap.set(row.produit_id, Number(row.counted_total || 0));
    });

    // 3) Pour chaque produit, calculer delta et créer stock_movement
    const allProduits = await client.query(
      `SELECT id, stock, prix FROM produits WHERE tenant_id = $1 AND deleted IS NOT TRUE`,
      [tenantId]
    );

    const adjustments = [];
    for (const prod of allProduits.rows) {
      const stockStart = Number(prod.stock || 0);
      const counted = countsMap.get(prod.id) || 0;
      const delta = counted - stockStart;

      if (delta !== 0) {
        // Créer mouvement de stock
        await client.query(
          `INSERT INTO stock_movements (tenant_id, produit_id, qty, source, reference_type, reference_id, created_at, meta)
           VALUES ($1, $2, $3, 'inventory', 'inventory_session', $4, NOW(), $5)`,
          [tenantId, prod.id, delta, sessionId, JSON.stringify({ counted, stock_start: stockStart, delta })]
        );

        // Mettre à jour stock produit
        await client.query(
          `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
          [counted, prod.id, tenantId]
        );

        adjustments.push({
          product_id: prod.id,
          stock_start: stockStart,
          counted_total: counted,
          delta: delta,
          unit_cost: Number(prod.prix || 0),
          delta_value: delta * Number(prod.prix || 0)
        });
      }
    }

    // 4) Sauvegarder les ajustements dans inventory_adjust
    for (const adj of adjustments) {
      await client.query(
        `INSERT INTO inventory_adjust (session_id, tenant_id, produit_id, stock_start, counted_total, delta, unit_cost, delta_value, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (session_id, tenant_id, produit_id) DO UPDATE SET
           stock_start = EXCLUDED.stock_start,
           counted_total = EXCLUDED.counted_total,
           delta = EXCLUDED.delta,
           unit_cost = EXCLUDED.unit_cost,
           delta_value = EXCLUDED.delta_value`,
        [sessionId, tenantId, adj.product_id, adj.stock_start, adj.counted_total, adj.delta, adj.unit_cost, adj.delta_value]
      );
    }

    // 5) Fermer la session
    await client.query(
      `UPDATE inventory_sessions
       SET status = 'closed', ended_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      recap: {
        session: { id: sessionId },
        adjustments: adjustments,
        total_adjustments: adjustments.length
      }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /inventory/:sessionId/finalize] error:', e);
    return res.status(500).json({ error: 'finalize failed', details: e.message });
  } finally {
    client.release();
  }
});

/**
 * GET /inventory/:sessionId/counts
 * Retourne les comptages détaillés par device pour une session.
 * Utile pour voir qui a compté quoi sur quel poste.
 */
router.get('/inventory/:sessionId/counts', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;

  if (!tenantId || !sessionId) {
    return res.status(400).json({ error: 'sessionId requis' });
  }

  try {
    const result = await pool.query(
      `SELECT 
         ic.produit_id,
         ic.device_id,
         ic."user",
         ic.qty,
         ic.updated_at,
         p.nom as product_name,
         p.code_barre,
         p.code_barres
       FROM inventory_counts ic
       LEFT JOIN produits p ON p.id = ic.produit_id AND p.tenant_id = ic.tenant_id
       WHERE ic.session_id = $1 AND ic.tenant_id = $2
       ORDER BY ic.updated_at DESC`,
      [sessionId, tenantId]
    );

    return res.json({
      ok: true,
      counts: result.rows
    });
  } catch (e) {
    console.error('[GET /inventory/:sessionId/counts] error:', e);
    return res.status(500).json({ error: 'failed to fetch counts', details: e.message });
  }
});

export default router;
