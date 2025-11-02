// server.js

console.log('[API] build=no-mailer v1 (multi-tenant full)');

import 'dotenv/config';
import express from 'express';
import tenantsRouter from './routes/tenants.js';

import cors from 'cors';

import { pool } from './db/index.js';

// Routes modularisées
import authRoutes from './routes/auth.js';
import tenantSettingsRoutes from './routes/tenantSettings.js';

// Middleware d’auth
import { authRequired } from './middleware/auth.js';

/* =========================
 * Checks de configuration
 * =======================*/
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute-le dans .env');
  process.exit(1);
}

/* =========================
 * App & middlewares
 * =======================*/
const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  exposedHeaders: ['x-tenant-id'],
}));
app.use(express.json({ limit: '10mb' }));
app.use('/tenants', tenantsRouter);

/* =========================
 * Health
 * =======================*/
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/health/db', async (_req, res) => {
  try {
    const r = await pool.query('select current_database() as db, current_user as usr');
    res.json({ ok: true, db: r.rows[0].db, usr: r.rows[0].usr });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Servez les fichiers statiques (logos…)
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/public', express.static(path.join(__dirname, 'public')));

// tests //
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import adherentsRoutes from './routes/adherents.js';

import adherentsRouter from './routes/adherents.js';
import fournisseursRouter from './routes/fournisseurs.js';
import produitsRouter from './routes/produits.js';
import receptionsRouter from './routes/receptions.js';
import ventesRouter from './routes/ventes.js';
import inventoryExtraRouter from './routes/inventory_extra.js';
import inventoryRoutes from './routes/inventory.js';
import inventoryExtra from './routes/inventory_extra.js';

app.use('/auth', authRouter);
app.use(settingsRouter);
app.use(adherentsRouter);
app.use(fournisseursRouter);
app.use(produitsRouter);
app.use(receptionsRouter);
app.use(ventesRouter);
app.use(inventoryExtraRouter);
app.use('/inventory', inventoryExtra);

app.use('/adherents', adherentsRoutes);
app.use('/inventory', inventoryRoutes);

/* =========================
 * Routes multi-tenant
 * =======================*/
app.use('/auth', authRoutes);
app.use('/tenant_settings', tenantSettingsRoutes);

/* ============================================
 * Helper: stock actuel (multi-tenant)
 * ==========================================*/
async function getCurrentStock(client, tenantId, productId) {
  const r = await client.query(
    `
    SELECT
      COALESCE((
        SELECT SUM(delta)::numeric
        FROM stock_movements
        WHERE tenant_id = $1 AND produit_id = $2
      ), p.stock, 0)::numeric AS stock
    FROM produits p
    WHERE p.tenant_id = $1 AND p.id = $2
    `,
    [tenantId, productId]
  );
  return Number(r.rows[0]?.stock || 0);
}

/* =========================================================
 * INVENTAIRE — version multi-tenant + nouveau schéma stock
 * =======================================================*/

app.post('/inventory/start', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const { name, user, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'name_required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, name, status, started_at
       FROM inventory_sessions
       WHERE tenant_id=$1 AND name=$2 AND status='open'
       ORDER BY started_at ASC LIMIT 1`,
      [tenantId, name]
    );
    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({ ok:true, session: existing.rows[0], reused: true });
    }

    const s = await client.query(
      `INSERT INTO inventory_sessions (tenant_id, name, "user", notes, status)
       VALUES ($1,$2,$3,$4,'open')
       RETURNING id, name, status, started_at`,
      [tenantId, name, user || null, notes || null]
    );
    const sessionId = s.rows[0].id;

    const prods = await client.query(
      `SELECT id, prix FROM produits WHERE tenant_id=$1 ORDER BY id`,
      [tenantId]
    );
    for (const p of prods.rows) {
      const stockStart = await getCurrentStock(client, tenantId, p.id);
      await client.query(
        `INSERT INTO inventory_snapshot(session_id, tenant_id, product_id, stock_start, unit_cost)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, product_id) DO NOTHING`,
        [sessionId, tenantId, p.id, stockStart, null]
      );
    }

    await client.query('COMMIT');
    res.json({ ok:true, session: s.rows[0], reused: false });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/start', e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

/** Ajouter un comptage (device) */
app.post('/inventory/:id/count-add', authRequired, async (req, res) => {
  const tenantId = req.tenantId;

  const sessionId = String(req.params.id || '');
  let productIdOrKey = req.body?.product_id;  // peut être uuid, ref, ou barcode
  const qtyRaw    = req.body?.qty;
  const deviceId  = req.body?.device_id;
  const user      = req.body?.user || null;

  const qty = Number(qtyRaw);

  if (!sessionId) return res.status(400).json({ ok:false, error:'bad_session_id' });
  if (!Number.isFinite(qty)) return res.status(400).json({ ok:false, error:'bad_qty' });
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ ok:false, error:'device_id_required' });
  }

  // petite aide
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normStr = v => (v == null ? '' : String(v)).trim();

  const client = await pool.connect();
  try {
    // 0) session ouverte ?
    const st = await client.query(
      `SELECT status FROM inventory_sessions WHERE tenant_id=$1 AND id=$2`,
      [tenantId, sessionId]
    );
    if (st.rowCount === 0) return res.status(404).json({ ok:false, error:'session_not_found' });
    if (st.rows[0].status !== 'open') return res.status(409).json({ ok:false, error:'session_locked' });

    // 1) Résoudre le produit
    let productUuid = null;
    const key = normStr(productIdOrKey);

    if (UUID_RE.test(key)) {
      // on t'a donné l'UUID
      productUuid = key;
    } else if (key) {
      // on t'a donné une référence OU un code_barre : on essaie d'abord par référence (souvent unique chez toi),
      // sinon par code_barre.
      const r1 = await client.query(
        `SELECT id FROM produits WHERE tenant_id=$1 AND reference = $2 LIMIT 1`,
        [tenantId, key]
      );
      if (r1.rowCount > 0) productUuid = String(r1.rows[0].id);

      if (!productUuid) {
        const r2 = await client.query(
          `SELECT id FROM produits WHERE tenant_id=$1 AND code_barre = $2 LIMIT 1`,
          [tenantId, key.replace(/\s+/g,'')] // normalise EAN sans espaces
        );
        if (r2.rowCount > 0) productUuid = String(r2.rows[0].id);
      }
    }

    if (!productUuid) {
      return res.status(400).json({ ok:false, error:'product_resolution_failed' });
    }

    // 2) Upsert du comptage pour (session_id, product_id, device_id)
    await client.query(
      `INSERT INTO inventory_counts(session_id, tenant_id, product_id, device_id, "user", qty, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (session_id, product_id, device_id)
       DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, updated_at=now()`,
      [sessionId, tenantId, productUuid, deviceId, user, qty]
    );

    return res.json({ ok:true });
  } catch (e) {
    console.error('POST /inventory/:id/count-add', e);
    return res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

app.get('/inventory/sessions', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const r = await client.query(`
      WITH cnt AS (
        SELECT session_id, product_id, SUM(qty)::numeric AS counted
        FROM inventory_counts
        WHERE tenant_id=$1
        GROUP BY session_id, product_id
      )
      SELECT
        s.id, s.name, s.status, s.started_at, s.ended_at,
        COUNT(sn.product_id)::int AS total_products,
        SUM(CASE WHEN COALESCE(c.counted,0) <> 0 THEN 1 ELSE 0 END)::int AS counted_lines,
        COALESCE(SUM(COALESCE(c.counted,0) * COALESCE(p.prix,0)),0)::numeric AS inventory_value
      FROM inventory_sessions s
      JOIN inventory_snapshot sn ON sn.session_id = s.id AND sn.tenant_id = s.tenant_id
      JOIN produits p ON p.id = sn.product_id AND p.tenant_id = s.tenant_id
      LEFT JOIN cnt c ON c.session_id = s.id AND c.product_id = sn.product_id
      WHERE s.tenant_id = $1
      GROUP BY s.id
      ORDER BY s.started_at DESC
    `, [tenantId]);
    res.json({ ok: true, sessions: r.rows });
  } catch (e) {
    console.error('GET /inventory/sessions', e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

app.get('/inventory/:id/summary', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const sessionId = String(req.params.id || '');
  if (!sessionId) return res.status(400).json({ ok:false, error:'bad_session_id' });

  const client = await pool.connect();
  try {
    const s = await client.query(
      `SELECT id FROM inventory_sessions WHERE tenant_id=$1 AND id=$2`,
      [tenantId, sessionId]
    );
    if (s.rowCount === 0) {
      return res.status(404).json({ ok:false, error:'session_not_found' });
    }

    const r = await client.query(
      `WITH summed AS (
         SELECT product_id, SUM(qty)::numeric AS counted_total
         FROM inventory_counts
         WHERE tenant_id=$1 AND session_id=$2
         GROUP BY product_id
       )
       SELECT
         p.id   AS product_id,
         p.nom,
         p.prix,
         COALESCE(s.counted_total, 0) AS counted_total
       FROM inventory_snapshot snap
       JOIN produits p ON p.id = snap.product_id AND p.tenant_id = snap.tenant_id
       LEFT JOIN summed s ON s.product_id = snap.product_id
       WHERE snap.tenant_id=$1 AND snap.session_id=$2
       ORDER BY p.nom`,
      [tenantId, sessionId]
    );

    res.json({ ok:true, lines: r.rows });
  } catch (e) {
    console.error('GET /inventory/:id/summary', e);
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/inventory/:id/finalize', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const sessionId = String(req.params.id || '');
  const { user } = req.body || {};
  const client = await pool.connect();

  if (!sessionId) return res.status(400).json({ ok:false, error:'bad_session_id' });

  try {
    await client.query('BEGIN');

    const st = await client.query(
      `SELECT id, status, name, started_at
       FROM inventory_sessions
       WHERE tenant_id=$1 AND id=$2
       FOR UPDATE`,
      [tenantId, sessionId]
    );
    if (st.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok:false, error:'session_not_found' });
    }

    const status = st.rows[0].status;

    if (status === 'closed') {
      await client.query('ROLLBACK');
      const rr = await pool.query(
        `SELECT
           COUNT(*)::int AS lines,
           COALESCE(SUM(delta_value),0)::numeric AS value
         FROM inventory_adjust
         WHERE tenant_id=$1 AND session_id=$2`,
        [tenantId, sessionId]
      );
      return res.json({
        ok: true,
        recap: {
          session: { id: sessionId, name: st.rows[0].name, started_at: st.rows[0].started_at, ended_at: null },
          stats:   { linesInserted: rr.rows[0].lines, countedProducts: rr.rows[0].lines, inventoryValue: Number(rr.rows[0].value) }
        },
        alreadyClosed: true
      });
    }

    if (status === 'open') {
      await client.query(
        `UPDATE inventory_sessions
           SET status='finalizing'
         WHERE tenant_id=$1 AND id=$2`,
        [tenantId, sessionId]
      );
    }

    const agg = await client.query(
      `WITH summed AS (
         SELECT product_id, SUM(qty)::numeric AS counted
         FROM inventory_counts
         WHERE tenant_id=$1 AND session_id=$2
         GROUP BY product_id
       )
       SELECT p.id AS product_id, p.nom, p.code_barre, p.prix,
              s.stock_start, COALESCE(sm.counted, 0) AS counted_total
       FROM inventory_snapshot s
       JOIN produits p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
       LEFT JOIN summed sm ON sm.product_id = s.product_id
       WHERE s.tenant_id=$1 AND s.session_id=$2
       ORDER BY p.nom`,
      [tenantId, sessionId]
    );

    let linesInserted = 0, countedProducts = 0, inventoryValue = 0;

    for (const r of agg.rows) {
      const pid     = String(r.product_id);
      const start   = Number(r.stock_start);
      const counted = Number(r.counted_total);
      const prix    = Number(r.prix || 0);

      const currentLive = await getCurrentStock(client, tenantId, pid);
      const delta = counted - currentLive;

      await client.query(
        `INSERT INTO inventory_adjust(session_id, tenant_id, product_id, stock_start, counted_total, delta, unit_cost, delta_value)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE NOT EXISTS (
           SELECT 1 FROM inventory_adjust
           WHERE session_id=$1 AND tenant_id=$2 AND product_id=$3
         )`,
        [sessionId, tenantId, pid, start, counted, delta, null, delta * prix]
      );

      const justInserted = await client.query(
        `SELECT 1 FROM inventory_adjust WHERE session_id=$1 AND tenant_id=$2 AND product_id=$3`,
        [sessionId, tenantId, pid]
      );
      if (justInserted.rowCount > 0) {
        linesInserted++;
        if (counted !== 0) countedProducts++;
        inventoryValue += counted * prix;
      }

      if (delta !== 0) {
        const sourceId = `inv:${sessionId}:${pid}`;
        await client.query(
          `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
           SELECT $1,$2,$3,'inventory_finalize',$4
           WHERE NOT EXISTS (
             SELECT 1 FROM stock_movements
             WHERE tenant_id=$1 AND source_id=$4
           )`,
          [tenantId, pid, delta, sourceId]
        );
      }
    }

    const endUpd = await client.query(
      `UPDATE inventory_sessions
         SET status='closed', ended_at=now(), "user"=COALESCE("user",$3)
       WHERE tenant_id=$1 AND id=$2
       RETURNING id, name, started_at, ended_at`,
      [tenantId, sessionId, user || null]
    );

    await client.query('COMMIT');

    const sess = endUpd.rows[0];
    const recap = {
      session: { id: sess.id, name: sess.name, started_at: sess.started_at, ended_at: sess.ended_at },
      stats:   { linesInserted, countedProducts, inventoryValue }
    };

    res.json({ ok: true, recap });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/:id/finalize', e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

/* =========================================================
 * SYNC (bootstrap / pull_refs / push_ops)
 * =======================================================*/
// Helper: retourne l'id si c'est un UUID v4 plausible, sinon null (forcera uuid_generate_v4() côté SQL)
function asUuidOrNull(x) {
  const s = (x ?? '').toString().trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

app.get('/sync/bootstrap_needed', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM produits WHERE tenant_id = $1`,
      [req.tenantId]
    );
    res.json({ ok: true, needed: (r.rows[0].n === 0) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, needed: true });
  }
});

app.get('/sync/pull_refs', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const [
      unites, familles, categories, adherents, fournisseurs, produits, modes_paiement
    ] = await Promise.all([
      client.query(
        `SELECT id, nom
         FROM unites
         WHERE tenant_id = $1
         ORDER BY nom`, [tenantId]
      ),
      client.query(
        `SELECT id, nom
         FROM familles
         WHERE tenant_id = $1
         ORDER BY nom`, [tenantId]
      ),
      client.query(
        `SELECT id, nom, famille_id
         FROM categories
         WHERE tenant_id = $1
         ORDER BY nom`, [tenantId]
      ),
      client.query(
        `SELECT *
         FROM adherents
         WHERE tenant_id = $1
         ORDER BY nom NULLS LAST`, [tenantId]
      ),
      client.query(
        `SELECT *
         FROM fournisseurs
         WHERE tenant_id = $1
         ORDER BY nom`, [tenantId]
      ),
      client.query(
        `
        SELECT
          p.id, p.nom, p.reference, p.prix, p.code_barre,
          p.unite_id, p.fournisseur_id, p.categorie_id, p.updated_at,
          COALESCE((
            SELECT SUM(delta)::numeric
            FROM stock_movements sm
            WHERE sm.tenant_id = p.tenant_id AND sm.produit_id = p.id
          ), p.stock, 0) AS stock
        FROM produits p
        WHERE p.tenant_id = $1
        ORDER BY p.nom
        `,
        [tenantId]
      ),
      client.query(
        `SELECT id, nom, taux_percent, frais_fixe, actif
         FROM modes_paiement
         WHERE tenant_id = $1
         ORDER BY nom`, [tenantId]
      ),
    ]);

    res.json({ ok: true, data: {
      unites: unites.rows,
      familles: familles.rows,
      categories: categories.rows,
      adherents: adherents.rows,
      fournisseurs: fournisseurs.rows,
      produits: produits.rows,
      modes_paiement: modes_paiement.rows
    }});
  } catch (e) {
    console.error('GET /sync/pull_refs error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/sync/push_ops', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const { deviceId, ops } = req.body || {};
  if (!deviceId || !Array.isArray(ops)) {
    return res.status(400).json({ ok: false, error: 'Bad payload' });
  }

  console.log('[API] /sync/push_ops received:', { deviceId, count: ops.length, tenantId });

  const order = { 'adherent.created': 1, 'adherent.updated': 2, 'sale.created': 10, 'sale.updated': 11 };
  ops.sort((a, b) => (order[a.op_type] || 100) - (order[b.op_type] || 100));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const op of ops) {
      let payloadObj;
      try {
        payloadObj = typeof op.payload_json === 'string' ? JSON.parse(op.payload_json) : (op.payload_json || {});
      } catch {
        payloadObj = {};
      }

      console.log('  → op:', op.op_type, 'entity:', op.entity_type, op.entity_id, 'payload:', payloadObj);

      try {
        await client.query(
          `INSERT INTO ops (id, tenant_id, device_id, op_type, entity_type, entity_id, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [op.id, tenantId, deviceId, op.op_type, op.entity_type || null, String(op.entity_id || ''), JSON.stringify(payloadObj)]
        );
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }

      let p = payloadObj;
      try {
        const r = await client.query(`SELECT applied_at, payload FROM ops WHERE id = $1`, [op.id]);
        if (r.rowCount > 0) {
          if (r.rows[0]?.applied_at) {
            console.log('    (déjà appliquée)');
            continue;
          }
          let fromDb = r.rows[0]?.payload;
          if (typeof fromDb === 'string') { try { fromDb = JSON.parse(fromDb); } catch {} }
          if (fromDb && typeof fromDb === 'object') p = fromDb;
        }
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }
      if (!p || typeof p !== 'object') p = {};

      switch (op.op_type) {
        case 'sale.created': {
          let venteId     = asUuidOrNull(p.venteId);
          let mpId        = asUuidOrNull(p.modePaiementId);
          let adherentId  = asUuidOrNull(p.adherentId);

          if (mpId) {
            const chk = await client.query(
              `SELECT 1 FROM modes_paiement WHERE tenant_id=$1 AND id=$2`,
              [tenantId, mpId]
            );
            if (chk.rowCount === 0) mpId = null;
          }
          if (adherentId) {
            const chkA = await client.query(
              `SELECT 1 FROM adherents WHERE tenant_id=$1 AND id=$2`,
              [tenantId, adherentId]
            );
            if (chkA.rowCount === 0) adherentId = null;
          }

          await client.query(
            `INSERT INTO ventes (id, tenant_id, total, adherent_id, mode_paiement_id, sale_type, client_email, frais_paiement, cotisation)
             VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`,
            [
              venteId, tenantId,
              p.total ?? null,
              adherentId,
              mpId,
              p.saleType || 'adherent',
              p.clientEmail || null,
              p.fraisPaiement ?? null,
              p.cotisation ?? null,
            ]
          );
          console.log('    [+] vente header enregistrée id=', venteId || '(auto)');
          break;
        }

        case 'sale.line_added': {
          const venteId   = asUuidOrNull(p.venteId);
          const produitId = asUuidOrNull(p.produitId);
          const ligneId   = asUuidOrNull(p.ligneId);

          if (!venteId)  throw new Error('invalid_vente_id_uuid');
          if (!produitId) throw new Error('invalid_produit_id_uuid');

          const sourceKey =
            (ligneId != null)
              ? `lv:${ligneId}`
              : `sale:${venteId}:${produitId}:${Number(p.quantite)}:${Number(p.prix)}`;

          const checkProd = await client.query(
            `SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`,
            [tenantId, produitId]
          );
          if (checkProd.rowCount === 0) throw new Error('product_not_found_for_tenant');

          const checkVente = await client.query(
            `SELECT 1 FROM ventes WHERE tenant_id=$1 AND id=$2`,
            [tenantId, venteId]
          );
          if (checkVente.rowCount === 0) throw new Error('sale_not_found_for_tenant');

          const quantite = Number(p.quantite || 0);
          const prix     = Number(p.prix || 0);

          const chk = await client.query(
            `SELECT 1 FROM lignes_vente
             WHERE tenant_id=$1 AND vente_id=$2 AND produit_id=$3 AND quantite=$4 AND prix=$5 LIMIT 1`,
            [tenantId, venteId, produitId, quantite, prix]
          );
          if (chk.rowCount === 0) {
            await client.query(
              `INSERT INTO lignes_vente (id, tenant_id, vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
               VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6,$7,$8)`,
              [ligneId || null, tenantId, venteId, produitId, quantite, prix, p.prixUnitaire ?? null, p.remisePercent ?? 0]
            );
            console.log('    [+] ligne_vente ajoutée vente=', venteId, 'prod=', produitId, 'qte=', quantite);
          } else {
            console.log('    [=] ligne_vente déjà présente');
          }

          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'sale_line',$4)
             ON CONFLICT DO NOTHING`,
            [tenantId, produitId, -quantite, sourceKey]
          );
          console.log('    [+] stock_movements sale_line', { produit_id: produitId, delta: -quantite, sourceKey });
          break;
        }

        case 'reception.line_added': {
          const pid = asUuidOrNull(p.produitId);
          const qte = Number(p.quantite || 0);
          if (!pid) throw new Error('invalid_produit_id_uuid');

          const chkP = await client.query(`SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`, [tenantId, pid]);
          if (chkP.rowCount === 0) throw new Error('product_not_found_for_tenant');

          let rid = asUuidOrNull(p.receptionId) || null;
          if (rid) {
            const chkR = await client.query(`SELECT 1 FROM receptions WHERE tenant_id=$1 AND id=$2`, [tenantId, rid]);
            if (chkR.rowCount === 0) {
              await client.query(
                `INSERT INTO receptions (id, tenant_id, fournisseur_id, date, reference)
                 VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, now(), $4)
                 ON CONFLICT (id) DO NOTHING`,
                [rid, tenantId, asUuidOrNull(p.fournisseurId) || null, p.reference || null]
              );
            }
          } else {
            const ins = await client.query(
              `INSERT INTO receptions (tenant_id, fournisseur_id, date, reference)
               VALUES ($1,$2, now(), $3)
               RETURNING id`,
              [tenantId, asUuidOrNull(p.fournisseurId) || null, p.reference || null]
            );
            rid = ins.rows[0].id;
          }

          if (asUuidOrNull(p.ligneRecId)) {
            await client.query(
              `INSERT INTO lignes_reception (id, tenant_id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2,$3,$4,$5,$6)
               ON CONFLICT (id) DO UPDATE SET
                 reception_id=EXCLUDED.reception_id,
                 produit_id=EXCLUDED.produit_id,
                 quantite=EXCLUDED.quantite,
                 prix_unitaire=EXCLUDED.prix_unitaire`,
              [asUuidOrNull(p.ligneRecId), tenantId, rid, pid, qte, p.prixUnitaire ?? null]
            );
          } else {
            await client.query(
              `INSERT INTO lignes_reception (tenant_id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1,$2,$3,$4,$5)`,
              [tenantId, rid, pid, qte, p.prixUnitaire ?? null]
            );
          }

          const currentStock = await getCurrentStock(client, tenantId, pid);
          const stockCorrige = (p.stockCorrige !== undefined && p.stockCorrige !== null) ? Number(p.stockCorrige) : null;
          const base = (stockCorrige !== null && !Number.isNaN(stockCorrige)) ? stockCorrige : currentStock;
          const target = base + qte;
          const delta = target - currentStock;

          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'reception_line',$4)
             ON CONFLICT DO NOTHING`,
            [tenantId, pid, delta, String(asUuidOrNull(p.ligneRecId) || `${rid}:${pid}`)]
          );
          console.log('    [+] stock_movements reception_line', { produit_id: pid, delta });

          if (p.prixUnitaire != null) {
            await client.query(
              `UPDATE produits SET prix = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
              [p.prixUnitaire, tenantId, pid]
            );
            console.log('    [~] prix produit mis à jour', { produit_id: pid, prix: p.prixUnitaire });
          }
          break;
        }

        case 'inventory.adjust': {
          const produitId = asUuidOrNull(p.produitId);
          const delta = Number(p.delta || 0);
          if (!produitId || !Number.isFinite(delta) || delta === 0) {
            console.warn('    [!] inventory.adjust ignorée — produitId/delta invalide');
            break;
          }
          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'inventory_adjust',$4)
             ON CONFLICT DO NOTHING`,
            [tenantId, produitId, delta, String(op.id)]
          );
          console.log('    [+] stock_movements inventory_adjust', { produit_id: produitId, delta });
          break;
        }

        case 'product.updated': {
          const fields = [];
          const values = [];
          let idx = 2;
          if (p.nom != null)           { fields.push(`nom = $${++idx}`);           values.push(p.nom); }
          if (p.reference != null)     { fields.push(`reference = $${++idx}`);     values.push(p.reference); }
          if (p.code_barre != null)    { fields.push(`code_barre = $${++idx}`);    values.push(p.code_barre); }
          if (p.prix != null)          { fields.push(`prix = $${++idx}`);          values.push(p.prix); }
          if (p.categorie_id != null)  { fields.push(`categorie_id = $${++idx}`);  values.push(asUuidOrNull(p.categorie_id)); }
          if (p.unite_id != null)      { fields.push(`unite_id = $${++idx}`);      values.push(asUuidOrNull(p.unite_id)); }
          if (p.fournisseur_id != null){ fields.push(`fournisseur_id = $${++idx}`);values.push(asUuidOrNull(p.fournisseur_id)); }

          if (fields.length > 0) {
            const sql = `UPDATE produits SET ${fields.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`;
            await client.query(sql, [tenantId, asUuidOrNull(p.id), ...values]);
            console.log('    [~] produit mis à jour', { id: p.id });
          }
          break;
        }

        default:
          console.log('    [?] op ignorée', op.op_type);
          break;
      }

      try {
        await client.query(`UPDATE ops SET applied_at = now() WHERE id=$1`, [op.id]);
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }
    }

    await client.query('COMMIT');
    console.log('[API] /sync/push_ops done.');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/push_ops error:', e);
    if (e?.code === '42P01') {
      return res.status(500).json({ ok:false, error: 'missing_table', detail: e.message });
    }
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/** Bootstrap (push TOUT local → Neon) — tenant-aware */
app.post('/sync/bootstrap', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const {
    unites = [], familles = [], categories = [], adherents = [],
    fournisseurs = [], produits = [], modes_paiement = []
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

 // Unités
for (const u of unites) {
  await client.query(`
    INSERT INTO unites (id, tenant_id, nom)
    VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3)
    ON CONFLICT (tenant_id, nom) DO UPDATE
      SET nom = EXCLUDED.nom
  `, [asUuidOrNull(u.id), tenantId, u.nom]);
}


// Familles
for (const f of familles) {
  await client.query(`
    INSERT INTO familles (id, tenant_id, nom)
    VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3)
    ON CONFLICT (tenant_id, nom) DO UPDATE
      SET nom = EXCLUDED.nom
  `, [asUuidOrNull(f.id), tenantId, f.nom]);
}


// Catégories
for (const c of categories) {
  await client.query(`
    INSERT INTO categories (id, tenant_id, nom, famille_id)
    VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4)
    ON CONFLICT (tenant_id, nom) DO UPDATE
      SET nom = EXCLUDED.nom,
          famille_id = COALESCE(EXCLUDED.famille_id, categories.famille_id)
  `, [asUuidOrNull(c.id), tenantId, c.nom, asUuidOrNull(c.famille_id)]);
}


    // Adhérents
    for (const a of adherents) {
      await client.query(`
        INSERT INTO adherents
         (id, tenant_id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
          nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (id) DO UPDATE SET
          nom=$3, prenom=$4, email1=$5, email2=$6, telephone1=$7, telephone2=$8, adresse=$9, code_postal=$10, ville=$11,
          nb_personnes_foyer=$12, tranche_age=$13, droit_entree=$14, date_inscription=$15,
          archive=$16, date_archivage=$17, date_reactivation=$18
      `, [
        asUuidOrNull(a.id), tenantId,
        a.nom || null, a.prenom || null, a.email1 || null, a.email2 || null, a.telephone1 || null, a.telephone2 || null,
        a.adresse || null, a.code_postal || null, a.ville || null,
        a.nb_personnes_foyer || null, a.tranche_age || null, a.droit_entree || null, a.date_inscription || null,
        a.archive || null, a.date_archivage || null, a.date_reactivation || null
      ]);
    }

    // Fournisseurs
    for (const f of fournisseurs) {
      await client.query(`
        INSERT INTO fournisseurs
         (id, tenant_id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, label)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          nom=$3, contact=$4, email=$5, telephone=$6, adresse=$7, code_postal=$8, ville=$9, categorie_id=$10, label=$11
      `, [
        asUuidOrNull(f.id), tenantId,
        f.nom, f.contact || null, f.email || null, f.telephone || null, f.adresse || null, f.code_postal || null, f.ville || null,
        asUuidOrNull(f.categorie_id), f.label || null
      ]);
    }

    // normalise un code-barres (supprime espaces/insécables/séparateurs)
function normBarcode(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, '').replace(/\u00A0/g, '').replace(/[^\w]/g, '');
  return s || null;
}


// ========= Produits (FK unite_id, fournisseur_id, categorie_id) =========
for (const p of produits) {
  await client.query(
    `
    INSERT INTO produits
      (id, tenant_id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
    VALUES
      (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    ON CONFLICT (tenant_id, reference) DO UPDATE SET
      nom = EXCLUDED.nom,
      prix = EXCLUDED.prix,
      stock = EXCLUDED.stock,
      code_barre = EXCLUDED.code_barre,
      unite_id = EXCLUDED.unite_id,
      fournisseur_id = EXCLUDED.fournisseur_id,
      categorie_id = EXCLUDED.categorie_id,
      updated_at = now()
    `,
    [
      asUuidOrNull(p.id),          // peut être null → UUID auto
      tenantId,
      p.nom,
      // ⚠️ reference DOIT être non nul et stable
      p.reference || `P-${String(p.id ?? '').padStart(6, '0')}`,
      Number(p.prix || 0),
      Number(p.stock ?? 0),
      p.code_barre || null,
      asUuidOrNull(p.unite_id),
      asUuidOrNull(p.fournisseur_id),
      asUuidOrNull(p.categorie_id)
    ]
  );
}

    // Modes de paiement
    for (const m of modes_paiement) {
      await client.query(`
        INSERT INTO modes_paiement (id, tenant_id, nom, taux_percent, frais_fixe, actif)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET
          nom=$3, taux_percent=$4, frais_fixe=$5, actif=$6
      `, [asUuidOrNull(m.id), tenantId, m.nom, Number(m.taux_percent || 0), Number(m.frais_fixe || 0), !!m.actif]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, counts: {
      unites: unites.length, familles: familles.length, categories: categories.length,
      adherents: adherents.length, fournisseurs: fournisseurs.length, produits: produits.length,
      modes_paiement: modes_paiement.length
    }});
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/bootstrap error:', e);
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});

/** Backfill mouvements à partir de produits.stock (legacy) — version MT */
app.post('/admin/backfill_stock', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `
      WITH to_seed AS (
        SELECT id AS produit_id, COALESCE(stock, 0) AS qty
        FROM produits p
        WHERE p.tenant_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
            WHERE sm.tenant_id = p.tenant_id AND sm.produit_id = p.id
          )
          AND COALESCE(stock, 0) <> 0
      )
      INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
      SELECT $1, ts.produit_id, ts.qty, 'bootstrap', 'bootstrap:'||ts.produit_id::text
      FROM to_seed ts
      ON CONFLICT DO NOTHING
      RETURNING *;
      `,
      [tenantId]
    );
    res.json({ ok: true, inserted: r.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/* =========================
 * Start server
 * =======================*/
const port = process.env.PORT || 3001;
app.listen(port, () => console.log('caisse-api listening on', port));
