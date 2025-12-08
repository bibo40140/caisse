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
router.post('/start', authRequired, async (req, res) => {
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
router.get('/sessions', authRequired, async (req, res) => {
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
 * body: { produit_id (uuid), qty (numeric), user?, device_id? }
 * Ajoute un comptage pour un produit dans une session.
 * Supporte plusieurs comptages du même produit (agrégation par device).
 */
router.post('/:sessionId/count-add', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;
  const { produit_id: produit_id, qty, user = null, device_id = null } = req.body || {};

  if (!tenantId || !sessionId || !produit_id || !Number.isFinite(Number(qty))) {
    return res.status(400).json({ error: 'champs requis: sessionId, produit_id, qty' });
  }

  const deviceIdFinal = device_id || req.headers['x-device-id'] || 'unknown';

  try {
    // Upsert: si déjà un comptage pour cette combinaison session/produit/device, on REMPLACE (pas d'accumulation)
    // Le frontend envoie des deltas, mais on veut stocker la valeur absolue finale
    // Donc on lit d'abord la valeur actuelle, on ajoute le delta, puis on stocke le résultat
    const current = await pool.query(
      `SELECT qty FROM inventory_counts 
       WHERE session_id = $1 AND produit_id = $2 AND device_id = $3`,
      [sessionId, produit_id, deviceIdFinal]
    );
    
    const currentQty = current.rows[0]?.qty || 0;
    const newQty = Number(currentQty) + Number(qty);
    
    await pool.query(
      `INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, "user", qty, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (session_id, produit_id, device_id)
       DO UPDATE SET
         qty = EXCLUDED.qty,
         "user" = COALESCE(EXCLUDED."user", inventory_counts."user"),
         updated_at = NOW()`,
      [sessionId, tenantId, produit_id, deviceIdFinal, user, newQty]
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
router.get('/:sessionId/summary', authRequired, async (req, res) => {
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

    // Agréger les comptages par produit (somme des device_id)
    const counts = await pool.query(
      `SELECT produit_id, SUM(qty) AS counted_total
       FROM inventory_counts
       WHERE session_id = $1 AND tenant_id = $2
       GROUP BY produit_id`,
      [sessionId, tenantId]
    );

    const countsMap = new Map();
    counts.rows.forEach(row => {
      countsMap.set(row.produit_id, Number(row.counted_total || 0));
    });

    // Récupérer aussi le détail par device_id pour l'affichage multiposte
    const countsByDevice = await pool.query(
      `SELECT produit_id, device_id, qty
       FROM inventory_counts
       WHERE session_id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );

    // Construire une map: produit_id => { device_id => qty }
    const deviceCountsMap = new Map();
    countsByDevice.rows.forEach(row => {
      if (!deviceCountsMap.has(row.produit_id)) {
        deviceCountsMap.set(row.produit_id, {});
      }
      deviceCountsMap.get(row.produit_id)[row.device_id] = Number(row.qty || 0);
    });

    // Récupérer tous les produits du tenant avec infos de base
    const produits = await pool.query(
      `SELECT id, nom, code_barre, code_barre, stock, prix, fournisseur_id, categorie_id
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
      const device_counts = deviceCountsMap.get(p.id) || {};

      return {
        produit_id: p.id,
        remote_produit_id: p.id, // Pour compat avec handler Electron
        remote_id: p.id,
        nom: p.nom,
        barcode: p.code_barre || p.code_barre || '',
        code_barre: p.code_barre || p.code_barre || '',
        stock_start: snp.stock_start,
        counted_total: counted,
        delta: delta,
        prix: Number(p.prix || 0),
        price: Number(p.prix || 0),
        unit_cost: snp.unit_cost,
        fournisseur_id: p.fournisseur_id || null,
        categorie_id: p.categorie_id || null,
        device_counts: device_counts // NOUVEAU: détail par terminal
      };
    });

    // Logs de debug pour diagnostic
    console.log('[summary] Renvoi de', lines.length, 'produits');
    const countedLines = lines.filter(l => l.counted_total > 0);
    if (countedLines.length > 0) {
      console.log('[summary] Exemple ligne comptée:', {
        nom: countedLines[0].nom,
        counted_total: countedLines[0].counted_total,
        prix: countedLines[0].prix,
        device_counts: countedLines[0].device_counts
      });
    }

    return res.json({
      ok: true,
      sessionId: sessionId,
      lines: lines,
      total_products: lines.length,
      counted_products: countedLines.length
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
router.post('/:sessionId/finalize', authRequired, async (req, res) => {
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

      // Créer mouvement et mettre à jour stock UNIQUEMENT pour les produits comptés
      if (countsMap.has(prod.id)) {
        // Produit a été compté : créer movement si delta !== 0 et toujours mettre à jour stock
        if (delta !== 0) {
          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
             VALUES ($1, $2, $3, 'inventory', $4, NOW())`,
            [tenantId, prod.id, delta, sessionId]
          );
        }
        
        // Mettre à jour le stock avec la quantité comptée
        await client.query(
          `UPDATE produits SET stock = $1 WHERE id = $2 AND tenant_id = $3`,
          [counted, prod.id, tenantId]
        );
      }
      // Si produit non compté : on ne touche PAS au stock (garde valeur actuelle)

      // Enregistrer l'ajustement si stock initial > 0 OU comptage > 0
      if (stockStart > 0 || counted > 0) {
        adjustments.push({
          produit_id: prod.id,
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
        [sessionId, tenantId, adj.produit_id, adj.stock_start, adj.counted_total, adj.delta, adj.unit_cost, adj.delta_value]
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
router.get('/:sessionId/counts', authRequired, async (req, res) => {
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
         p.code_barre
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

/**
 * POST /inventory/:sessionId/mark-finished
 * body: { device_id }
 * Marque qu'un device a terminé ses comptages.
 * Quand tous les devices ont terminé, l'inventaire peut être clôturé.
 */
router.post('/:sessionId/mark-finished', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;
  const { device_id } = req.body || {};

  if (!tenantId || !sessionId || !device_id) {
    console.error('[mark-finished] BAD ARG', { tenantId, sessionId, device_id });
    return res.status(400).json({ error: 'sessionId et device_id requis', tenantId, sessionId, device_id });
  }

  try {
    // Créer ou mettre à jour le statut
    const result = await pool.query(
      `INSERT INTO inventory_device_status (session_id, tenant_id, device_id, status, last_activity, finished_at)
       VALUES ($1, $2, $3, 'finished', NOW(), NOW())
       ON CONFLICT (session_id, device_id)
       DO UPDATE SET
         status = 'finished',
         finished_at = NOW(),
         last_activity = NOW()`,
      [sessionId, tenantId, device_id]
    );
    console.log('[mark-finished] OK', { sessionId, tenantId, device_id, rowCount: result.rowCount });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /inventory/:sessionId/mark-finished] error:', e, { sessionId, tenantId, device_id });
    return res.status(500).json({ error: 'failed to mark finished', details: e.message, sessionId, tenantId, device_id });
  }
});

/**
 * GET /inventory/:sessionId/device-status
 * Retourne le statut de tous les devices qui ont participé à l'inventaire.
 * Permet de savoir qui a terminé et qui est encore en train de compter.
 */
router.get('/:sessionId/device-status', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const sessionId = req.params.sessionId;

  if (!tenantId || !sessionId) {
    return res.status(400).json({ error: 'sessionId requis' });
  }

  try {
    // Récupérer tous les devices qui ont compté + leur statut
    const devices = await pool.query(
      `SELECT DISTINCT 
         ic.device_id,
         COALESCE(ids.status, 'counting') as status,
         ids.finished_at,
         MAX(ic.updated_at) as last_count_at
       FROM inventory_counts ic
       LEFT JOIN inventory_device_status ids 
         ON ids.session_id = ic.session_id AND ids.device_id = ic.device_id
       WHERE ic.session_id = $1 AND ic.tenant_id = $2
       GROUP BY ic.device_id, ids.status, ids.finished_at
       ORDER BY ic.device_id`,
      [sessionId, tenantId]
    );

    const total = devices.rows.length;
    const finished = devices.rows.filter(d => d.status === 'finished').length;
    const allFinished = total > 0 && finished === total;

    return res.json({
      ok: true,
      devices: devices.rows,
      total,
      finished,
      allFinished
    });
  } catch (e) {
    console.error('[GET /inventory/:sessionId/device-status] error:', e);
    return res.status(500).json({ error: 'failed to fetch device status', details: e.message });
  }
});

export default router;
