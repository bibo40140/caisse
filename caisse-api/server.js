// server.js

console.log('[API] build=no-mailer v1 (multi-tenant full)');

function asIntOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// Helper: retourne l'id si c'est un UUID v4 plausible, sinon null
function asUuidOrNull(x) {
  const s = (x ?? '').toString().trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

import 'dotenv/config';

console.log(
  '[AUTH DEV] DEV_SUPERADMIN_ENABLED=',
  process.env.DEV_SUPERADMIN_ENABLED,
  'DEV_SUPERADMIN_EMAIL=',
  process.env.DEV_SUPERADMIN_EMAIL
);

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { pool } from './db/index.js';

// Routers
import tenantsRouter from './routes/tenants.js';
import authRouter from './routes/auth.js';
import tenantSettingsRoutes from './routes/tenantSettings.js';
import makeBrandingRouter from './routes/branding.js';

import settingsRouter from './routes/settings.js';
import adherentsRouter from './routes/adherents.js';
import fournisseursRouter from './routes/fournisseurs.js';
import produitsRouter from './routes/produits.js';
import receptionsRouter from './routes/receptions.js';
import ventesRouter from './routes/ventes.js';
import inventoryRoutes from './routes/inventory.js';

// Middleware
import { authRequired } from './middleware/auth.js';
import { performanceMiddleware, startPeriodicReport } from './middleware/performance.js';

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

// Compression gzip pour réponses > 100KB
app.use(compression({
  threshold: 102400, // 100KB - compresse seulement si réponse > 100KB
  level: 6, // Niveau de compression (1-9, 6 = bon compromis vitesse/taux)
}));

// 📊 Monitoring de performance
app.use(performanceMiddleware);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
    exposedHeaders: ['x-tenant-id'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.url);
  next();
});

// Tenants
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

// Static (logos, uploads…)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* =========================
 * Routes "classiques"
 * =======================*/
app.use('/auth', authRouter);
app.use(settingsRouter);
app.use(adherentsRouter);
app.use(fournisseursRouter);
app.use(produitsRouter);
app.use(receptionsRouter);
app.use(ventesRouter);
app.use('/inventory', inventoryRoutes);

/* =========================
 * Routes multi-tenant
 * =======================*/
app.use('/tenant_settings', tenantSettingsRoutes);

// Branding multi-tenant (protégé)
app.use('/branding', authRequired, makeBrandingRouter({ pool }));

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

/* ============================================
 * Helpers SYNC adhérents
 * ==========================================*/

/**
 * Applique une création d'adhérent reçue depuis une op "adherent.created"
 * - client: client PG transactionnel
 * - tenantId: UUID du tenant
 * - payload: objet envoyé depuis l'app Electron (voir logs push_ops)
 */
async function applyAdherentCreated(client, tenantId, payload) {
  const p = payload || {};

  const nom    = (p.nom || '').trim() || null;
  const prenom = (p.prenom || '').trim() || null;

  const email1Norm = (p.email1 || '').trim().toLowerCase();
  const email1 = email1Norm || null;
  const email2 = (p.email2 || '').trim() || null;

  const telephone1 = (p.telephone1 || '').trim() || null;
  const telephone2 = (p.telephone2 || '').trim() || null;

  const adresse     = (p.adresse || '').trim() || null;
  const codePostal  = (p.code_postal || '').trim() || null;
  const ville       = (p.ville || '').trim() || null;

  const nbPersFoyer = p.nb_personnes_foyer ?? null;
  const trancheAge  = p.tranche_age ?? null;
  const droitEntree = p.droit_entree != null ? Number(p.droit_entree) : null;

  const dateInscription = p.date_inscription || null;
  const archive         = !!p.archive;
  const dateArchivage   = p.date_archivage || null;
  const dateReactivation = p.date_reactivation || null;

  // 🔁 Idempotence / anti-doublon : si un adhérent avec le même email1 existe déjà → on ne recrée pas.
  if (email1) {
    const ex = await client.query(
      `
      SELECT id
      FROM adherents
      WHERE tenant_id = $1
        AND LOWER(COALESCE(email1, '')) = $2
      LIMIT 1
      `,
      [tenantId, email1]
    );
    if (ex.rowCount > 0) {
      console.log('    [=] adherent déjà présent pour email1 =', email1);
      return ex.rows[0].id;
    }
  }

  // Insertion (sans colonne "statut")
  const r = await client.query(
    `
    INSERT INTO adherents
      (tenant_id, nom, prenom,
       email1, email2,
       telephone1, telephone2,
       adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age,
       droit_entree, date_inscription,
       archive, date_archivage, date_reactivation)
    VALUES
      ($1,$2,$3,
       $4,$5,
       $6,$7,
       $8,$9,$10,
       $11,$12,
       $13,
       COALESCE($14::timestamptz, now()),
       $15,$16,$17)
    RETURNING id
    `,
    [
      tenantId,
      nom, prenom,
      email1, email2,
      telephone1, telephone2,
      adresse, codePostal, ville,
      nbPersFoyer, trancheAge,
      droitEntree,
      dateInscription,
      archive, dateArchivage, dateReactivation,
    ]
  );

  const newId = r.rows[0]?.id;
  console.log('    [+] adherent créé / réutilisé, id =', newId);
  return newId;
}
/* =========================================================
 * INVENTAIRE — version multi-tenant + nouveau schéma stock
 * =======================================================*/

app.post('/inventory/start', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const { name, user, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fermer toutes les autres sessions "open" pour ce tenant
    await client.query(
      `
      UPDATE inventory_sessions
         SET status='closed', ended_at=now()
       WHERE tenant_id=$1 AND status='open'
      `,
      [tenantId]
    );

    // (Sécurité) si une session "open" du même nom traîne encore
    const existing = await client.query(
      `
      SELECT id, name, status, started_at
      FROM inventory_sessions
      WHERE tenant_id=$1 AND name=$2 AND status='open'
      ORDER BY started_at ASC LIMIT 1
      `,
      [tenantId, name]
    );
    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({ ok: true, session: existing.rows[0], reused: true });
    }

    // Crée la nouvelle session ouverte
    const s = await client.query(
      `
      INSERT INTO inventory_sessions (tenant_id, name, "user", notes, status)
      VALUES ($1,$2,$3,$4,'open')
      RETURNING id, name, status, started_at
      `,
      [tenantId, name, user || null, notes || null]
    );
    const sessionId = s.rows[0].id;

    // Snapshot initial de tous les produits
    const prods = await client.query(
      `SELECT id, prix FROM produits WHERE tenant_id=$1 ORDER BY id`,
      [tenantId]
    );
    for (const p of prods.rows) {
      const stockStart = await getCurrentStock(client, tenantId, p.id);
      await client.query(
        `
        INSERT INTO inventory_snapshot(session_id, tenant_id, product_id, stock_start, unit_cost)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (session_id, product_id) DO NOTHING
        `,
        [sessionId, tenantId, p.id, stockStart, null]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, session: s.rows[0], reused: false });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/start', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/** Ajouter un comptage (device) */
app.post('/inventory/:id/count-add', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const sessionId = String(req.params.id || '');
  let productIdOrKey = req.body?.product_id; // uuid, ref, ou barcode
  const qtyRaw = req.body?.qty;
  const deviceId = req.body?.device_id;
  const user = req.body?.user || null;

  const qty = Number(qtyRaw);

  if (!sessionId) return res.status(400).json({ ok: false, error: 'bad_session_id' });
  if (!Number.isFinite(qty)) return res.status(400).json({ ok: false, error: 'bad_qty' });
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ ok: false, error: 'device_id_required' });
  }

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normStr = (v) => (v == null ? '' : String(v)).trim();

  const client = await pool.connect();
  try {
    // Session ouverte ?
    const st = await client.query(
      `SELECT status FROM inventory_sessions WHERE tenant_id=$1 AND id=$2`,
      [tenantId, sessionId]
    );
    if (st.rowCount === 0) return res.status(404).json({ ok: false, error: 'session_not_found' });
    if (st.rows[0].status !== 'open')
      return res.status(409).json({ ok: false, error: 'session_locked' });

    // Résoudre le produit → id (uuid ou ref ou code-barres)
    let productUuid = null;
    const key = normStr(productIdOrKey);

    if (UUID_RE.test(key)) {
      productUuid = key;
    } else if (key) {
      const r1 = await client.query(
        `SELECT id FROM produits WHERE tenant_id=$1 AND reference = $2 LIMIT 1`,
        [tenantId, key]
      );
      if (r1.rowCount > 0) productUuid = String(r1.rows[0].id);

      if (!productUuid) {
        const r2 = await client.query(
          `SELECT id FROM produits WHERE tenant_id=$1 AND code_barre = $2 LIMIT 1`,
          [tenantId, key.replace(/\s+/g, '')]
        );
        if (r2.rowCount > 0) productUuid = String(r2.rows[0].id);
      }
    }

    if (!productUuid) {
      return res.status(400).json({ ok: false, error: 'product_resolution_failed' });
    }

    // Upsert comptage
    await client.query(
      `
      INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, "user", qty, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (session_id, produit_id, device_id)
      DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, updated_at=now()
      `,
      [sessionId, tenantId, productUuid, deviceId, user, qty]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /inventory/:id/count-add', e);
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/inventory/sessions', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `
      WITH snap AS (
         SELECT session_id, COUNT(*)::int AS snapshot_lines
         FROM inventory_snapshot
         WHERE tenant_id = $1
         GROUP BY session_id
       ),
       cnt AS (
         SELECT
           session_id,
           COUNT(DISTINCT produit_id)::int AS counted_products,
           MAX(updated_at)               AS last_count_at
         FROM inventory_counts
         WHERE tenant_id = $1
         GROUP BY session_id
       )
       SELECT
         s.id, s.name, s.status, s.notes, s."user",
         s.started_at, s.ended_at,
         COALESCE(sn.snapshot_lines, 0) AS snapshot_lines,
         COALESCE(cn.counted_products, 0) AS counted_products,
         cn.last_count_at
       FROM inventory_sessions s
       LEFT JOIN snap sn ON sn.session_id = s.id
       LEFT JOIN cnt  cn ON cn.session_id = s.id
       WHERE s.tenant_id = $1
       ORDER BY s.started_at DESC
      `,
      [tenantId]
    );

    res.json({ ok: true, items: r.rows });
  } catch (e) {
    console.error('GET /inventory/sessions', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/inventory/close-all-open', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `
      UPDATE inventory_sessions
         SET status='closed', ended_at=now()
       WHERE tenant_id=$1 AND status='open'
       RETURNING id, name, started_at, ended_at
      `,
      [tenantId]
    );
    res.json({ ok: true, closed: r.rows });
  } catch (e) {
    console.error('POST /inventory/close-all-open', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/inventory/:id/summary', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const sessionId = String(req.params.id || '');
  if (!sessionId) return res.status(400).json({ ok: false, error: 'bad_session_id' });

  const client = await pool.connect();
  try {
    const s = await client.query(
      `SELECT id FROM inventory_sessions WHERE tenant_id=$1 AND id=$2`,
      [tenantId, sessionId]
    );
    if (s.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'session_not_found' });
    }

    // Comptages par produit (total)
    const summed = await client.query(
      `
      SELECT produit_id, SUM(qty)::numeric AS counted_total
      FROM inventory_counts
      WHERE tenant_id=$1 AND session_id=$2
      GROUP BY produit_id
      `,
      [tenantId, sessionId]
    );
    const countsMap = new Map(summed.rows.map(r => [r.produit_id, Number(r.counted_total || 0)]));

    // Comptages par device
    const byDevice = await client.query(
      `
      SELECT produit_id, device_id, SUM(qty)::numeric AS qty
      FROM inventory_counts
      WHERE tenant_id=$1 AND session_id=$2
      GROUP BY produit_id, device_id
      `,
      [tenantId, sessionId]
    );
    const deviceCountsMap = new Map();
    for (const row of byDevice.rows) {
      if (!deviceCountsMap.has(row.produit_id)) deviceCountsMap.set(row.produit_id, {});
      deviceCountsMap.get(row.produit_id)[row.device_id] = Number(row.qty || 0);
    }

    // Produits de ce tenant (inclure code barre et FK utiles)
    const produits = await client.query(
      `
      SELECT id, nom, prix, code_barre, fournisseur_id, categorie_id
      FROM produits
      WHERE tenant_id=$1 AND (deleted IS NULL OR deleted = false)
      ORDER BY nom
      `,
      [tenantId]
    );

    const lines = produits.rows.map(p => ({
      product_id: p.id,
      remote_product_id: p.id,
      nom: p.nom,
      barcode: p.code_barre || '',
      code_barres: p.code_barre || '',
      prix: Number(p.prix || 0),
      price: Number(p.prix || 0),
      counted_total: countsMap.get(p.id) || 0,
      fournisseur_id: p.fournisseur_id || null,
      categorie_id: p.categorie_id || null,
      device_counts: deviceCountsMap.get(p.id) || {}
    }));

    res.json({ ok: true, sessionId, lines, total_products: lines.length });
  } catch (e) {
    console.error('GET /inventory/:id/summary', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/inventory/:id/finalize', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const sessionId = String(req.params.id || '');
  const { user } = req.body || {};
  if (!sessionId) return res.status(400).json({ ok: false, error: 'bad_session_id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock la session
    const st = await client.query(
      `
      SELECT id, status, name, started_at, ended_at
      FROM inventory_sessions
      WHERE tenant_id=$1 AND id=$2
      FOR UPDATE
      `,
      [tenantId, sessionId]
    );
    if (st.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'session_not_found' });
    }
    if (st.rows[0].status === 'closed') {
      await client.query('ROLLBACK');
      const rr = await pool.query(
        `
        SELECT COUNT(*)::int AS lines,
               COALESCE(SUM(delta_value),0)::numeric AS value
        FROM inventory_adjust
        WHERE tenant_id=$1 AND session_id=$2
        `,
        [tenantId, sessionId]
      );
      return res.json({
        ok: true,
        recap: {
          session: {
            id: sessionId,
            name: st.rows[0].name,
            started_at: st.rows[0].started_at,
            ended_at: st.rows[0].ended_at || null,
          },
          stats: {
            linesInserted: rr.rows[0].lines,
            countedProducts: rr.rows[0].lines,
            inventoryValue: Number(rr.rows[0].value),
          },
        },
        alreadyClosed: true,
      });
    }

    if (st.rows[0].status === 'open') {
      await client.query(
        `
        UPDATE inventory_sessions SET status='finalizing'
        WHERE tenant_id=$1 AND id=$2
        `,
        [tenantId, sessionId]
      );
    }

    // Agrégat snapshot + comptages
    const agg = await client.query(
      `
      WITH summed AS (
         SELECT produit_id, SUM(qty)::numeric AS counted_total
         FROM inventory_counts
         WHERE tenant_id=$1 AND session_id=$2
         GROUP BY produit_id
       )
       SELECT
         s.product_id        AS product_id,
         p.nom,
         p.prix,
         s.stock_start,
         COALESCE(sm.counted_total, 0) AS counted_total
       FROM inventory_snapshot s
       JOIN produits p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
       LEFT JOIN summed sm ON sm.produit_id = s.product_id
       WHERE s.tenant_id=$1 AND s.session_id=$2
       ORDER BY p.nom
      `,
      [tenantId, sessionId]
    );

    let linesInserted = 0,
      countedProducts = 0,
      inventoryValue = 0;

    for (const r of agg.rows) {
      const pid = String(r.product_id);
      const start = Number(r.stock_start || 0);
      const counted = Number(r.counted_total || 0);
      const prix = Number(r.prix || 0);

      const currentLive = await getCurrentStock(client, tenantId, pid);
      const delta = counted - currentLive;

      await client.query(
        `
        INSERT INTO inventory_adjust(session_id, tenant_id, product_id, stock_start, counted_total, delta, unit_cost, delta_value, created_at)
        VALUES ($1,$2,$3,$4,$5,$6, NULL, $7, now())
        ON CONFLICT (session_id, tenant_id, product_id)
        DO UPDATE SET
           stock_start   = EXCLUDED.stock_start,
           counted_total = EXCLUDED.counted_total,
           delta         = EXCLUDED.delta,
           delta_value   = EXCLUDED.delta_value
        `,
        [sessionId, tenantId, pid, start, counted, delta, delta * prix]
      );

      linesInserted++;
      if (counted !== 0) countedProducts++;
      inventoryValue += counted * prix;

      if (delta !== 0) {
        const sourceId = `inv:${sessionId}:${pid}`;
        await client.query(
          `
          INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
          SELECT $1,$2,$3,'inventory_finalize',$4, now()
          WHERE NOT EXISTS (
            SELECT 1 FROM stock_movements WHERE tenant_id=$1 AND source_id=$4
          )
          `,
          [tenantId, pid, delta, sourceId]
        );
      }
    }

    const endUpd = await client.query(
      `
      UPDATE inventory_sessions
         SET status='closed', ended_at=now(), "user"=COALESCE("user",$3)
       WHERE tenant_id=$1 AND id=$2
       RETURNING id, name, started_at, ended_at
      `,
      [tenantId, sessionId, user || null]
    );

    await client.query('COMMIT');

    const sess = endUpd.rows[0];
    res.json({
      ok: true,
      recap: {
        session: {
          id: sess.id,
          name: sess.name,
          started_at: sess.started_at,
          ended_at: sess.ended_at,
        },
        stats: { linesInserted, countedProducts, inventoryValue },
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/:id/finalize', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/* =========================================================
 * SYNC (bootstrap / pull_refs / push_ops)
 * =======================================================*/

async function applyFournisseurUpsert(client, tenantId, p = {}, mappingsArray = null) {
  const nom = (p.nom || '').trim();
  if (!nom) return;

  const localId = p.id || p.localId || null; // ID local (INTEGER)

  const r = await client.query(
    `
    INSERT INTO fournisseurs
      (tenant_id, nom, contact, email, telephone, adresse, code_postal, ville, label)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (tenant_id, nom) DO UPDATE SET
      contact     = EXCLUDED.contact,
      email       = EXCLUDED.email,
      telephone   = EXCLUDED.telephone,
      adresse     = EXCLUDED.adresse,
      code_postal = EXCLUDED.code_postal,
      ville       = EXCLUDED.ville,
      label       = EXCLUDED.label
    RETURNING id
    `,
    [
      tenantId,
      nom,
      p.contact || null,
      p.email || null,
      p.telephone || null,
      p.adresse || null,
      p.code_postal || null,
      p.ville || null,
      p.label || null,
    ]
  );
  const remoteUuid = r.rows[0]?.id || null;

  // 🔥 Collecter le mapping si localId et mappingsArray fournis
  if (remoteUuid && localId && mappingsArray) {
    mappingsArray.push({ local_id: localId, remote_uuid: remoteUuid });
  }

  return remoteUuid;
}

async function applyAdherentUpdated(client, tenantId, p) {
  const nom    = (p.nom || '').trim() || null;
  const prenom = (p.prenom || '').trim() || null;
  const email1 = (p.email1 || '').trim().toLowerCase() || null;
  const email2 = (p.email2 || '').trim() || null;
  const telephone1 = (p.telephone1 || '').trim() || null;
  const telephone2 = (p.telephone2 || '').trim() || null;
  const adresse = (p.adresse || '').trim() || null;
  const codePostal = (p.code_postal || '').trim() || null;
  const ville = (p.ville || '').trim() || null;

  // Prefer update by explicit id if provided
  const remoteId = asIntOrNull(p.id) || null;
  if (remoteId) {
    await client.query(
      `
      UPDATE adherents SET
        nom = $1, prenom = $2,
        email1 = $3, email2 = $4,
        telephone1 = $5, telephone2 = $6,
        adresse = $7, code_postal = $8, ville = $9,
        nb_personnes_foyer = $10, tranche_age = $11,
        updated_at = now()
      WHERE tenant_id = $12 AND id = $13
      `,
      [
        nom, prenom,
        email1, email2,
        telephone1, telephone2,
        adresse, codePostal, ville,
        p.nb_personnes_foyer ?? null, p.tranche_age ?? null,
        tenantId, remoteId,
      ]
    );
    return remoteId;
  }

  // Try to update by email1 if present
  if (email1) {
    const r = await client.query(
      `SELECT id FROM adherents WHERE tenant_id = $1 AND LOWER(COALESCE(email1, '')) = $2 LIMIT 1`,
      [tenantId, email1]
    );
    if (r.rowCount > 0) {
      const id = r.rows[0].id;
      await client.query(
        `
        UPDATE adherents SET
          nom = $1, prenom = $2,
          email2 = $3,
          telephone1 = $4, telephone2 = $5,
          adresse = $6, code_postal = $7, ville = $8,
          nb_personnes_foyer = $9, tranche_age = $10,
          updated_at = now()
        WHERE tenant_id = $11 AND id = $12
        `,
        [
          nom, prenom,
          email2,
          telephone1, telephone2,
          adresse, codePostal, ville,
          p.nb_personnes_foyer ?? null, p.tranche_age ?? null,
          tenantId, id,
        ]
      );
      return id;
    }
  }

  // Fallback: create if not found
  return await applyAdherentCreated(client, tenantId, p);
}

async function applyAdherentArchive(client, tenantId, p) {
  const remoteId = asIntOrNull(p.id) || null;
  const archive = p.archive ? true : false;
  if (remoteId) {
    await client.query(
      `UPDATE adherents SET archive = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
      [archive, tenantId, remoteId]
    );
    return remoteId;
  }
  // Try by local email
  const email1 = (p.email1 || '').trim().toLowerCase();
  if (email1) {
    await client.query(`UPDATE adherents SET archive = $1, updated_at = now() WHERE tenant_id = $2 AND LOWER(COALESCE(email1,'')) = $3`, [archive, tenantId, email1]);
  }
  return null;
}

async function applyFournisseurCreated(client, tenantId, p, mappingsArray = null) {
  return applyFournisseurUpsert(client, tenantId, p, mappingsArray);
}

async function applyFournisseurUpdated(client, tenantId, p, mappingsArray = null) {
  return applyFournisseurUpsert(client, tenantId, p, mappingsArray);
}


app.get('/sync/bootstrap_needed', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM produits WHERE tenant_id = $1`,
      [req.tenantId]
    );
    res.json({ ok: true, needed: r.rows[0].n === 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, needed: true });
  }
});

app.get('/sync/pull_refs', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const client = await pool.connect();
  try {
    const [unites, familles, categories, adherents, fournisseurs, produits, modes_paiement, stock_movements, inventory_sessions] =
      await Promise.all([
        client.query(
          `
          SELECT id, nom
          FROM unites
          WHERE tenant_id = $1
          ORDER BY nom
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT id, nom
          FROM familles
          WHERE tenant_id = $1
          ORDER BY nom
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT id, nom, famille_id
          FROM categories
          WHERE tenant_id = $1
          ORDER BY nom
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT *
          FROM adherents
          WHERE tenant_id = $1
          ORDER BY nom NULLS LAST
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT *
          FROM fournisseurs
          WHERE tenant_id = $1
          ORDER BY nom
          `,
          [tenantId]
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
            AND (p.deleted IS NULL OR p.deleted = false)
          ORDER BY p.nom
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT id, nom, taux_percent, frais_fixe, actif
          FROM modes_paiement
          WHERE tenant_id = $1
          ORDER BY nom
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT id, produit_id, delta, source, source_id, created_at
          FROM stock_movements
          WHERE tenant_id = $1
          ORDER BY created_at
          `,
          [tenantId]
        ),
        client.query(
          `
          SELECT id, name, status, started_at, ended_at, "user", notes
          FROM inventory_sessions
          WHERE tenant_id = $1 AND status = 'open'
          ORDER BY started_at DESC
          `,
          [tenantId]
        ),
      ]);

    // Récupérer aussi les modules du tenant
    const modulesRes = await client.query(
      `SELECT modules_json FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const modules = modulesRes.rows[0]?.modules_json || {};

    res.json({
      ok: true,
      data: {
        unites: unites.rows,
        familles: familles.rows,
        categories: categories.rows,
        adherents: adherents.rows,
        fournisseurs: fournisseurs.rows,
        produits: produits.rows,
        modes_paiement: modes_paiement.rows,
        stock_movements: stock_movements.rows,
        inventory_sessions: inventory_sessions.rows,
        modules: modules,
      },
    });
  } catch (e) {
    console.error('GET /sync/pull_refs error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// SYNC VENTES (historique complet avec lignes) - avec support since= et pagination
// ═══════════════════════════════════════════════════════════════════
app.get('/sync/pull_ventes', authRequired, async (req, res) => {
  const startTime = Date.now(); // 📊 Performance monitoring
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ ok: false, error: 'Tenant requis' });

  const since = req.query.since || null; // timestamp ISO pour pull incrémental
  const limit = parseInt(req.query.limit) || 1000; // Pagination: max 1000 items par défaut
  const offset = parseInt(req.query.offset) || 0; // Pagination: offset pour page suivante
  
  // Limiter à 5000 max pour éviter surcharge mémoire
  const safeLimit = Math.min(limit, 5000);
  
  const client = await pool.connect();

  try {
    // Count total pour pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM ventes
      WHERE tenant_id = $1
    `;
    const countParams = [tenantId];
    
    if (since) {
      countQuery += ` AND updated_at > $2`;
      countParams.push(since);
    }
    
    const countRes = await client.query(countQuery, countParams);
    const total = parseInt(countRes.rows[0].total);
    
    // Récupérer les ventes avec pagination
    let ventesQuery = `
      SELECT id, adherent_id, date, montant, mode_paiement_id, created_at, updated_at
      FROM ventes
      WHERE tenant_id = $1
    `;
    const ventesParams = [tenantId];
    let paramIndex = 2;
    
    if (since) {
      ventesQuery += ` AND updated_at > $${paramIndex}`;
      ventesParams.push(since);
      paramIndex++;
    }
    
    ventesQuery += ` ORDER BY date, id LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    ventesParams.push(safeLimit, offset);
    
    const ventesRes = await client.query(ventesQuery, ventesParams);
    const ventes = ventesRes.rows;

    // Récupérer toutes les lignes pour ces ventes (optimisé avec ANY)
    const ventesIds = ventes.map(v => v.id);
    let lignes = [];
    
    if (ventesIds.length > 0) {
      const lignesRes = await client.query(
        `
        SELECT id, vente_id, produit_id, quantite, prix_unitaire
        FROM lignes_vente
        WHERE vente_id = ANY($1::uuid[])
        ORDER BY vente_id, id
        `,
        [ventesIds]
      );
      lignes = lignesRes.rows;
    }

    const elapsed = Date.now() - startTime;
    const hasMore = offset + ventes.length < total;
    
    // 📊 Log de performance
    if (elapsed > 1000) {
      console.warn(`[PERF] /sync/pull_ventes lent: ${elapsed}ms pour ${ventes.length} ventes`);
    }

    res.json({
      ok: true,
      data: {
        ventes,
        lignes_vente: lignes,
      },
      meta: {
        count: ventes.length,
        total: total,
        offset: offset,
        limit: safeLimit,
        hasMore: hasMore,
        since: since || null,
        timestamp: new Date().toISOString(),
        elapsed_ms: elapsed, // Temps de réponse pour monitoring
      },
    });
  } catch (e) {
    console.error('GET /sync/pull_ventes error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// SYNC RECEPTIONS (historique complet avec lignes) - avec support since= et pagination
// ═══════════════════════════════════════════════════════════════════
app.get('/sync/pull_receptions', authRequired, async (req, res) => {
  const startTime = Date.now(); // 📊 Performance monitoring
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ ok: false, error: 'Tenant requis' });

  const since = req.query.since || null;
  const limit = parseInt(req.query.limit) || 1000; // Pagination: max 1000 items par défaut
  const offset = parseInt(req.query.offset) || 0; // Pagination: offset pour page suivante
  
  // Limiter à 5000 max pour éviter surcharge mémoire
  const safeLimit = Math.min(limit, 5000);
  
  const client = await pool.connect();

  try {
    // Count total pour pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM receptions
      WHERE tenant_id = $1
    `;
    const countParams = [tenantId];
    
    if (since) {
      countQuery += ` AND updated_at > $2`;
      countParams.push(since);
    }
    
    const countRes = await client.query(countQuery, countParams);
    const total = parseInt(countRes.rows[0].total);
    
    // Récupérer les réceptions avec pagination
    let receptionsQuery = `
      SELECT id, fournisseur_id, date, reference, updated_at
      FROM receptions
      WHERE tenant_id = $1
    `;
    const receptionsParams = [tenantId];
    let paramIndex = 2;
    
    if (since) {
      receptionsQuery += ` AND updated_at > $${paramIndex}`;
      receptionsParams.push(since);
      paramIndex++;
    }
    
    receptionsQuery += ` ORDER BY date, id LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    receptionsParams.push(safeLimit, offset);
    
    const receptionsRes = await client.query(receptionsQuery, receptionsParams);
    const receptions = receptionsRes.rows;

    // Récupérer toutes les lignes pour ces réceptions (optimisé avec ANY)
    const receptionsIds = receptions.map(r => r.id);
    let lignes = [];
    
    if (receptionsIds.length > 0) {
      const lignesRes = await client.query(
        `
        SELECT id, reception_id, produit_id, quantite, prix_unitaire
        FROM lignes_reception
        WHERE reception_id = ANY($1::uuid[])
        ORDER BY reception_id, id
        `,
        [receptionsIds]
      );
      lignes = lignesRes.rows;
    }

    const elapsed = Date.now() - startTime;
    const hasMore = offset + receptions.length < total;
    
    // 📊 Log de performance
    if (elapsed > 1000) {
      console.warn(`[PERF] /sync/pull_receptions lent: ${elapsed}ms pour ${receptions.length} réceptions`);
    }

    res.json({
      ok: true,
      data: {
        receptions,
        lignes_reception: lignes,
      },
      meta: {
        count: receptions.length,
        total: total,
        offset: offset,
        limit: safeLimit,
        hasMore: hasMore,
        since: since || null,
        timestamp: new Date().toISOString(),
        elapsed_ms: elapsed, // Temps de réponse pour monitoring
      },
    });
  } catch (e) {
    console.error('GET /sync/pull_receptions error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// Helpers pour les ops produits
// ---------------------------------------------------------------------

function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

// ---------------------------------------------------------------------
// Helpers pour les ops produits
// ---------------------------------------------------------------------
async function handleProductCreated(client, tenantId, p) {
  const localId = asIntOrNull(p.local_id ?? p.id);
  const nom = (p.nom || '').trim();

  if (!nom) {
    console.warn('[push_ops] product.created ignorée — nom manquant', p);
    return null;
  }

  const reference = p.reference || null;
  if (!reference) {
    console.warn('[push_ops] product.created sans reference, ignoré', p);
    return null;
  }

  const prix      = Number(p.prix ?? 0);
  const stock     = Number(p.stock ?? 0);
  const codeBarre = p.code_barre || null;
  // Foreign key fields - expect UUID values from client
  const uniteId       = p.unite_id || null;
  const categorieId   = p.categorie_id || null;
  const fournisseurId = p.fournisseur_id || null;

  try {
    const res = await client.query(
      `
      INSERT INTO produits (
        tenant_id,
        nom,
        reference,
        prix,
        stock,
        code_barre,
        unite_id,
        fournisseur_id,
        categorie_id,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (tenant_id, reference) DO UPDATE SET
        nom            = EXCLUDED.nom,
        prix           = EXCLUDED.prix,
        stock          = EXCLUDED.stock,
        code_barre     = EXCLUDED.code_barre,
        unite_id       = EXCLUDED.unite_id,
        fournisseur_id = EXCLUDED.fournisseur_id,
        categorie_id   = EXCLUDED.categorie_id,
        updated_at     = now()
      RETURNING id
      `,
      [tenantId, nom, reference, prix, stock, codeBarre, uniteId, fournisseurId, categorieId]
    );

    const remoteId = res.rows?.[0]?.id || null;
    console.log('    [+] produit upsert sur Neon', {
      localId,
      remoteId,
      reference,
      nom,
      prix,
      stock,
    });

    // Créer un mouvement de stock initial si stock > 0
    if (remoteId && stock > 0) {
      await client.query(
        `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
         VALUES ($1, $2, $3, 'initial', $4, now())`,
        [tenantId, remoteId, stock, `product_${remoteId}`]
      );
      console.log(`    [+] stock_movement initial créé: +${stock}`);
    }

    // Si pas de remoteId ou pas de localId (op ancienne / corrompue) → pas de mapping
    if (!remoteId || !localId) return null;

    // Ce mapping servira côté client pour remplir produits.remote_uuid
    return {
      local_id: localId,
      remote_uuid: remoteId,
      reference,
    };
  } catch (e) {
    // Gestion propre des doublons (référence / code-barre)
    if (e.code === '23505') {
      console.warn(
        '[push_ops] product.created ignoré (duplicate unique constraint) :',
        e.detail || e.message
      );
      // On considère l'op "consommée"
      return null;
    }
    // Autre erreur → on remonte
    throw e;
  }
}



/**
 * Met à jour un produit existant sur Neon.
 * On s’appuie sur l’UUID Neon (remote_id / remote_uuid / entity_id).
 */
async function handleProductUpdated(client, tenantId, payload, op) {
  const p = payload || {};
  const localId  = p.local_id != null ? Number(p.local_id) : null;

  // 1) on cherche un UUID fiable
  let remoteId = null;

  if (p.remote_uuid && isUuid(p.remote_uuid)) {
    remoteId = p.remote_uuid;
  } else if (p.remote_id && isUuid(p.remote_id)) {
    remoteId = p.remote_id;
  } else if (op.entity_id && isUuid(String(op.entity_id))) {
    remoteId = String(op.entity_id);
  }

  if (!remoteId) {
    console.log(
      '    [i] product.updated sans remote_uuid valide, ignorée côté Neon',
      { localId, entity_id: op.entity_id }
    );
    return;
  }

  const fields = [];
  const values = [tenantId, remoteId];
  let idx = 2;

  if (p.nom != null) {
    fields.push(`nom = $${++idx}`);
    values.push(p.nom);
  }
  if (p.reference != null) {
    fields.push(`reference = $${++idx}`);
    values.push(p.reference);
  }
  if (p.code_barre != null) {
    fields.push(`code_barre = $${++idx}`);
    values.push(p.code_barre);
  }
  if (p.prix != null) {
    fields.push(`prix = $${++idx}`);
    values.push(Number(p.prix));
  }
  if (p.stock != null) {
    fields.push(`stock = $${++idx}`);
    values.push(Number(p.stock));
  }
  // Foreign key fields - accept UUID values from client
  if (p.unite_id !== undefined) {
    fields.push(`unite_id = $${++idx}`);
    values.push(p.unite_id); // can be UUID or null
  }
  if (p.categorie_id !== undefined) {
    fields.push(`categorie_id = $${++idx}`);
    values.push(p.categorie_id); // can be UUID or null
  }
  if (p.fournisseur_id !== undefined) {
    fields.push(`fournisseur_id = $${++idx}`);
    values.push(p.fournisseur_id); // can be UUID or null
  }

  if (!fields.length) {
    console.log('    [i] product.updated sans champs modifiés, rien à faire.');
    return;
  }

  const sql = `
    UPDATE produits
       SET ${fields.join(', ')}, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
  `;
  await client.query(sql, values);
  console.log('    [~] produit mis à jour sur Neon', {
    localId,
    remoteId,
  });
}



// ---------------------------------------------------------------------
// Route /sync/push_ops
// ---------------------------------------------------------------------
app.post('/sync/push_ops', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const { deviceId, ops } = req.body || {};
  if (!deviceId || !Array.isArray(ops)) {
    return res.status(400).json({ ok: false, error: 'Bad payload' });
  }

  console.log('[API] /sync/push_ops received:', { deviceId, count: ops.length, tenantId });

  const order = {
    // Adhérents
    'adherent.created': 1,
    'adherent.updated': 2,

    // Fournisseurs
    'fournisseur.created': 2,
    'fournisseur.updated': 3,

    // Produits
    'product.created': 4,
    'product.updated': 5,

    // Ventes
    'sale.created': 10,
    'sale.updated': 11,
    'sale.line_added': 12,

    // Stock & réceptions
    'reception.line_added': 20,
    'inventory.adjust': 30,
  };

  ops.sort((a, b) => (order[a.op_type] || 100) - (order[b.op_type] || 100));

  const client = await pool.connect();
  // 👉 on va accumuler ici les mappings produits local_id -> remote_uuid
  const productMappings = [];
  // mappings sessions local_id -> remote_uuid (pour ops inventory.session_start)
  const sessionMappings = [];
  // mappings ventes local_id -> remote_uuid
  const venteMappings = [];
  // mappings receptions local_id -> remote_uuid
  const receptionMappings = [];
  // mappings fournisseurs local_id -> remote_uuid
  const fournisseurMappings = [];
  // Collecte des ventes créées pour envoi email
  const ventesCreees = [];

  try {
    await client.query('BEGIN');

    for (const op of ops) {
      let payloadObj;
      try {
        payloadObj =
          typeof op.payload_json === 'string'
            ? JSON.parse(op.payload_json)
            : op.payload_json || {};
      } catch {
        payloadObj = {};
      }

      console.log(
        '  → op:',
        op.op_type,
        'entity:',
        op.entity_type,
        op.entity_id,
        'payload:',
        payloadObj
      );

      // Enregistre l'op dans la table ops (idempotent)
      try {
        await client.query(
          `
          INSERT INTO ops (id, tenant_id, device_id, op_type, entity_type, entity_id, payload)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
          ON CONFLICT (id) DO NOTHING
          `,
          [
            op.id,
            tenantId,
            deviceId,
            op.op_type,
            op.entity_type || null,
            String(op.entity_id || ''),
            JSON.stringify(payloadObj),
          ]
        );
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }

      let p = payloadObj;
      try {
        const r = await client.query(`SELECT applied_at, payload FROM ops WHERE id = $1`, [
          op.id,
        ]);
        if (r.rowCount > 0) {
          if (r.rows[0]?.applied_at) {
            console.log('    (déjà appliquée)');
            continue;
          }
          let fromDb = r.rows[0]?.payload;
          if (typeof fromDb === 'string') {
            try {
              fromDb = JSON.parse(fromDb);
            } catch {}
          }
          if (fromDb && typeof fromDb === 'object') p = fromDb;
        }
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }
      if (!p || typeof p !== 'object') p = {};

      switch (op.op_type) {
        /* ─────────────────────────────
         * ADHERENTS
         * ────────────────────────────*/
        case 'adherent.created': {
          await applyAdherentCreated(client, tenantId, p);
          break;
        }
        case 'adherent.updated': {
          await applyAdherentUpdated(client, tenantId, p);
          break;
        }
        case 'adherent.archived': {
          await applyAdherentArchive(client, tenantId, p);
          break;
        }
        case 'adherent.reactivated': {
          // reactivation = archive = false
          p.archive = 0;
          await applyAdherentArchive(client, tenantId, p);
          break;
        }

        /* ─────────────────────────────
         * FOURNISSEURS
         * ────────────────────────────*/
        case 'fournisseur.created': {
          await applyFournisseurCreated(client, tenantId, p, fournisseurMappings);
          break;
        }

        case 'fournisseur.updated': {
          await applyFournisseurUpdated(client, tenantId, p, fournisseurMappings);
          break;
        }

        /* ─────────────────────────────
         * VENTES
         * ────────────────────────────*/
        case 'sale.created': {
          const localVenteId = asIntOrNull(p.venteId);

          // 🔥 Générer un UUID pour la vente (Postgres n'accepte pas d'INTEGER)
          const venteUuid = crypto.randomUUID();

          // 🔥 Le client envoie directement les UUIDs dans adherentUuid et modePaiementUuid
          const adherentUuid = p.adherentUuid || null;
          const modePaiementUuid = p.modePaiementUuid || null;

          const r = await client.query(
            `
            INSERT INTO ventes (
               id, tenant_id, total, adherent_id, mode_paiement_id,
               sale_type, client_email, frais_paiement, cotisation, acompte
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (id) DO NOTHING
             RETURNING id
            `,
            [
              venteUuid,
              tenantId,
              p.total ?? null,
              adherentUuid,
              modePaiementUuid,
              p.saleType || 'adherent',
              p.clientEmail || null,
              p.fraisPaiement ?? null,
              p.cotisation ?? null,
              p.acompte ?? null,
            ]
          );
          
          if (r.rowCount > 0) {
            console.log('    [+] vente header enregistrée uuid=', venteUuid, 'local_id=', localVenteId);
            // 🔥 Ajouter le mapping pour retour au client
            if (localVenteId != null) {
              venteMappings.push({ local_id: localVenteId, remote_uuid: venteUuid });
            }
            // Collecter pour envoi email
            ventesCreees.push({
              venteUuid,
              adherentUuid,
              clientEmail: p.clientEmail || null,
              total: p.total ?? 0,
              fraisPaiement: p.fraisPaiement ?? 0,
              cotisation: p.cotisation ?? 0,
              acompte: p.acompte ?? 0,
              modePaiementUuid
            });
          }
          break;
        }

        case 'sale.updated': {
          const venteId = asIntOrNull(p.venteId) || asIntOrNull(p.id);
          if (!venteId) {
            console.warn('    [!] sale.updated missing id');
            break;
          }
          const mpId = asIntOrNull(p.modePaiementId) || null;
          const adherentId = asIntOrNull(p.adherentId) || null;
          const fields = [];
          const values = [tenantId];
          let idx = 1;
          if (p.total != null) {
            fields.push(`total = $${++idx}`);
            values.push(Number(p.total));
          }
          if (mpId != null) {
            fields.push(`mode_paiement_id = $${++idx}`);
            values.push(mpId);
          }
          if (adherentId != null) {
            fields.push(`adherent_id = $${++idx}`);
            values.push(adherentId);
          }
          if (!fields.length) {
            console.log('    [i] sale.updated sans champs modifiés, rien à faire.');
            break;
          }
          values.push(venteId);
          const sql = `UPDATE ventes SET ${fields.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $${++idx}`;
          await client.query(sql, values);
          console.log('    [~] vente mise à jour id=', venteId);
          break;
        }

        case 'sale.line_added': {
          // 🔥 Résoudre venteUuid : soit déjà mappé dans ce batch, soit dans la DB
          const localVenteId = asIntOrNull(p.venteId);
          let venteUuid = null;

          if (localVenteId != null) {
            // Chercher dans venteMappings (même batch)
            const mapping = venteMappings.find(m => m.local_id === localVenteId);
            venteUuid = mapping?.remote_uuid || null;
          }

          const produitUuid = p.produitUuid || null;

          if (!venteUuid) throw new Error('invalid_vente_uuid');
          if (!produitUuid) throw new Error('invalid_produit_uuid');

          const quantite = Number(p.quantite || 0);
          const prix = Number(p.prix || 0);

          const sourceKey = `sale:${venteUuid}:${produitUuid}:${quantite}:${prix}`;

          const checkProd = await client.query(
            `SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`,
            [tenantId, produitUuid]
          );
          if (checkProd.rowCount === 0)
            throw new Error('product_not_found_for_tenant');

          const checkVente = await client.query(
            `SELECT 1 FROM ventes WHERE tenant_id=$1 AND id=$2`,
            [tenantId, venteUuid]
          );
          if (checkVente.rowCount === 0)
            throw new Error('sale_not_found_for_tenant');

          const chk = await client.query(
            `
            SELECT 1 FROM lignes_vente
             WHERE tenant_id=$1 AND vente_id=$2 AND produit_id=$3 AND quantite=$4 AND prix=$5
             LIMIT 1
            `,
            [tenantId, venteUuid, produitUuid, quantite, prix]
          );

          if (chk.rowCount === 0) {
            await client.query(
              `
              INSERT INTO lignes_vente
                 (tenant_id, vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
              `,
              [
                tenantId,
                venteUuid,
                produitUuid,
                quantite,
                prix,
                p.prixUnitaire ?? null,
                p.remisePercent ?? 0,
              ]
            );
            console.log(
              '    [+] ligne_vente ajoutée vente=',
              venteUuid,
              'prod=',
              produitUuid,
              'qte=',
              quantite
            );
          } else {
            console.log('    [=] ligne_vente déjà présente');
          }

          await client.query(
            `
            INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'sale_line',$4)
             ON CONFLICT DO NOTHING
            `,
            [tenantId, produitUuid, -quantite, sourceKey]
          );
          console.log('    [+] stock_movements sale_line', {
            produit_id: produitUuid,
            delta: -quantite,
          });
          break;
        }

        /* ─────────────────────────────
         * RÉCEPTIONS
         * ────────────────────────────*/
        case 'reception.line_added': {
          const localReceptionId = asIntOrNull(p.receptionId);
          const localProduitId = asIntOrNull(p.produitId);
          const localFournisseurId = asIntOrNull(p.fournisseurId);

          // 🔥 Résoudre les UUIDs
          let receptionUuid = p.receptionUuid || null;
          const fournisseurUuid = p.fournisseurUuid || null;
          let produitUuid = p.produitUuid || null;

          // Si produitUuid est null, on cherche dans les mappings du même batch
          if (!produitUuid && localProduitId) {
            const mapping = productMappings.find(m => m.local_id === localProduitId);
            if (mapping) {
              produitUuid = mapping.remote_uuid;
              console.log('    [~] produitUuid résolu via mappings batch:', { localProduitId, produitUuid });
            }
          }

          // Si toujours null, chercher le produit dans la DB par sa référence
          // (le produit a peut-être été créé dans un batch précédent)
          if (!produitUuid && p.produitReference) {
            const prodQuery = await client.query(
              `SELECT id FROM produits WHERE tenant_id=$1 AND reference=$2 LIMIT 1`,
              [tenantId, p.produitReference]
            );
            if (prodQuery.rowCount > 0) {
              produitUuid = prodQuery.rows[0].id;
              console.log('    [~] produitUuid résolu via DB (reference):', { reference: p.produitReference, produitUuid });
            }
          }

          // Si receptionUuid est null, on cherche dans les mappings du même batch (comme pour venteUuid)
          if (!receptionUuid && localReceptionId) {
            const mapping = receptionMappings.find(m => m.local_id === localReceptionId);
            if (mapping) {
              receptionUuid = mapping.remote_uuid;
            }
          }

          // Si toujours pas de receptionUuid, créer le header maintenant
          if (!receptionUuid && localReceptionId) {
            receptionUuid = crypto.randomUUID();
            const reference = p.reference || null;

            await client.query(
              `INSERT INTO receptions (id, tenant_id, fournisseur_id, date, reference)
               VALUES ($1, $2, $3, NOW(), $4)
               ON CONFLICT (id) DO NOTHING`,
              [receptionUuid, tenantId, fournisseurUuid, reference]
            );
            receptionMappings.push({ local_id: localReceptionId, remote_uuid: receptionUuid });
            console.log('    [+] reception header créée uuid=', receptionUuid, 'local_id=', localReceptionId);
          }

          // Validation finale
          if (!receptionUuid) throw new Error('invalid_reception_uuid');
          if (!produitUuid) {
            console.error('    [!] produitUuid manquant pour reception.line_added:', {
              localReceptionId, localProduitId, localFournisseurId,
              receptionUuid, fournisseurUuid, produitUuid,
              payload: p
            });
            throw new Error('invalid_produit_uuid_for_reception');
          }

          const quantite = Number(p.quantite || 0);
          const prixAchat = p.prixUnitaire != null ? Number(p.prixUnitaire) : null;

          // Vérifier que le produit existe
          const checkProd = await client.query(
            `SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`,
            [tenantId, produitUuid]
          );
          if (checkProd.rowCount === 0) throw new Error('product_not_found_for_tenant');

          // Insérer la ligne de réception (idempotent)
          const chk = await client.query(
            `SELECT 1 FROM lignes_reception 
             WHERE tenant_id=$1 AND reception_id=$2 AND produit_id=$3 AND quantite=$4 
               AND COALESCE(prix_unitaire,0.0)=COALESCE($5::numeric,0.0)
             LIMIT 1`,
            [tenantId, receptionUuid, produitUuid, quantite, prixAchat]
          );

          if (chk.rowCount === 0) {
            await client.query(
              `INSERT INTO lignes_reception (tenant_id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1,$2,$3,$4,$5)`,
              [tenantId, receptionUuid, produitUuid, quantite, prixAchat]
            );
            console.log('    [+] ligne_reception ajoutée reception=', receptionUuid, 'prod=', produitUuid, 'qte=', quantite);
          } else {
            console.log('    [=] ligne_reception déjà présente');
          }

          // Stock movement
          const sourceKey = `lr:${localReceptionId || receptionUuid}:${localProduitId || produitUuid}:${quantite}`;
          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id) 
             VALUES ($1,$2,$3,'reception_line',$4) 
             ON CONFLICT DO NOTHING`,
            [tenantId, produitUuid, quantite, sourceKey]
          );
          console.log('    [+] stock_movements reception_line', { produit_id: produitUuid, delta: quantite });
          break;
        }

        /* ─────────────────────────────
         * INVENTAIRE / PRODUITS
         * ────────────────────────────*/
        case 'inventory.adjust': {
          const produitIdLocal = asIntOrNull(p.produitId);
          const delta = Number(p.delta || 0);

          if (!produitIdLocal || !Number.isFinite(delta) || delta === 0) {
            console.warn(
              '    [!] inventory.adjust ignorée — produitId/delta invalide',
              p
            );
            break;
          }

          // Résoudre produitUuid via les mappings du batch
          let produitUuid = null;
          const mapping = productMappings.find(m => m.local_id === produitIdLocal);
          if (mapping) {
            produitUuid = mapping.remote_uuid;
          }

          if (!produitUuid) {
            console.warn(
              '    [!] inventory.adjust ignorée — produit non résolu',
              { produitIdLocal, delta }
            );
            break;
          }

          // Créer le mouvement de stock
          const sourceKey = `inventory_adjust:${produitUuid}:${delta}:${Date.now()}`;
          await client.query(
            `INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1, $2, $3, 'inventory_adjust', $4)
             ON CONFLICT DO NOTHING`,
            [tenantId, produitUuid, delta, sourceKey]
          );
          console.log('    [+] stock_movements inventory.adjust', { 
            produit_id: produitUuid, 
            delta,
            reason: p.reason 
          });
          break;
        }

        case 'inventory.session_start': {
          // payload: { local_session_id, name, user, notes }
          const localId = p.local_session_id || p.localId || null;
          const name = p.name || `Inventaire ${new Date().toISOString().slice(0,10)}`;
          const user = p.user || null;

          const newIdRes = await client.query(
            `INSERT INTO inventory_sessions (id, tenant_id, name, "user", notes, status, started_at)
             VALUES (uuid_generate_v4(), $1, $2, $3, $4, 'open', now())
             RETURNING id`,
            [tenantId, name, user, p.notes || null]
          );
          const remoteId = newIdRes.rows[0]?.id || null;
          if (localId && remoteId) sessionMappings.push({ local_id: localId, remote_uuid: remoteId });
          break;
        }

        case 'inventory.count_add': {
          // payload: { session_id, local_product_id, product_uuid, qty, user, device_id }
          let sessionIdRemote = null;
          if (p.session_id && typeof p.session_id === 'string' && /^[0-9a-f\-]{36}$/.test(p.session_id)) sessionIdRemote = p.session_id;
          else if (p.session_id) {
            const mapped = sessionMappings.find(m => String(m.local_id) === String(p.session_id));
            if (mapped) sessionIdRemote = mapped.remote_uuid;
          }
          if (!sessionIdRemote) {
            console.warn('[push_ops] inventory.count_add: session not resolved in batch', p.session_id);
            break;
          }

          // Resolve product uuid: prefer explicit product_uuid, then productMappings
          let productUuid = null;
          if (p.product_uuid && typeof p.product_uuid === 'string' && /^[0-9a-f\-]{36}$/.test(p.product_uuid)) productUuid = p.product_uuid;
          else if (p.local_product_id) {
            const pm = productMappings.find(x => Number(x.local_id) === Number(p.local_product_id));
            if (pm) productUuid = pm.remote_uuid;
          }
          if (!productUuid) {
            console.warn('[push_ops] inventory.count_add: product not resolved in batch', p.local_product_id);
            break;
          }

          // Upsert count into inventory_counts
          try {
            await client.query(
              `
              INSERT INTO inventory_counts (session_id, tenant_id, produit_id, device_id, "user", qty, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6, now())
              ON CONFLICT (session_id, produit_id, device_id)
              DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, updated_at=now()
              `,
              [sessionIdRemote, tenantId, productUuid, p.device_id || null, p.user || null, Number(p.qty || 0)]
            );
          } catch (e) {
            console.warn('[push_ops] inventory.count_add failed', e?.message || e);
          }
          break;
        }
        
        case 'inventory.finalize': {
          // payload: { session_id, user }
          let sessionIdRemote = null;
          if (p.session_id && typeof p.session_id === 'string' && /^[0-9a-f\-]{36}$/.test(p.session_id)) sessionIdRemote = p.session_id;
          else if (p.session_id) {
            const mapped = sessionMappings.find(m => String(m.local_id) === String(p.session_id));
            if (mapped) sessionIdRemote = mapped.remote_uuid;
          }
          if (!sessionIdRemote) {
            console.warn('[push_ops] inventory.finalize: session not resolved in batch', p.session_id);
            break;
          }

          // user info optional
          const userFinal = p.user || null;

          // Check session exists and status
          const st = await client.query(`SELECT status, name, started_at, ended_at FROM inventory_sessions WHERE tenant_id=$1 AND id=$2`, [tenantId, sessionIdRemote]);
          if (st.rowCount === 0) {
            console.warn('[push_ops] inventory.finalize: remote session not found', sessionIdRemote);
            break;
          }
          if (st.rows[0].status === 'closed') {
            // already closed -> nothing to do
            break;
          }

          if (st.rows[0].status === 'open') {
            await client.query(`UPDATE inventory_sessions SET status='finalizing' WHERE tenant_id=$1 AND id=$2`, [tenantId, sessionIdRemote]);
          }

          // Aggregate snapshot + counts and apply adjustments (reuse endpoint logic)
          const agg = await client.query(`
            WITH summed AS (
               SELECT produit_id, SUM(qty)::numeric AS counted_total
               FROM inventory_counts
               WHERE tenant_id=$1 AND session_id=$2
               GROUP BY produit_id
             )
             SELECT
               s.product_id        AS product_id,
               p.nom,
               p.prix,
               s.stock_start,
               COALESCE(sm.counted_total, 0) AS counted_total
             FROM inventory_snapshot s
             JOIN produits p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
             LEFT JOIN summed sm ON sm.produit_id = s.product_id
             WHERE s.tenant_id=$1 AND s.session_id=$2
             ORDER BY p.nom
          `, [tenantId, sessionIdRemote]);

          let linesInserted = 0, countedProducts = 0, inventoryValue = 0;
          for (const r of agg.rows) {
            const pid = String(r.product_id);
            const start = Number(r.stock_start || 0);
            const counted = Number(r.counted_total || 0);
            const prix = Number(r.prix || 0);

            const currentLive = await getCurrentStock(client, tenantId, pid);
            const delta = counted - currentLive;

            await client.query(`
              INSERT INTO inventory_adjust(session_id, tenant_id, product_id, stock_start, counted_total, delta, unit_cost, delta_value, created_at)
              VALUES ($1,$2,$3,$4,$5,$6, NULL, $7, now())
              ON CONFLICT (session_id, tenant_id, product_id)
              DO UPDATE SET
                 stock_start   = EXCLUDED.stock_start,
                 counted_total = EXCLUDED.counted_total,
                 delta         = EXCLUDED.delta,
                 delta_value   = EXCLUDED.delta_value
            `, [sessionIdRemote, tenantId, pid, start, counted, delta, delta * prix]);

            linesInserted++;
            if (counted !== 0) countedProducts++;
            inventoryValue += counted * prix;

            if (delta !== 0) {
              const sourceId = `inv:${sessionIdRemote}:${pid}`;
              await client.query(`
                INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id, created_at)
                SELECT $1,$2,$3,'inventory_finalize',$4, now()
                WHERE NOT EXISTS (
                  SELECT 1 FROM stock_movements WHERE tenant_id=$1 AND source_id=$4
                )
              `, [tenantId, pid, delta, sourceId]);
            }
          }

          await client.query(`
            UPDATE inventory_sessions
               SET status='closed', ended_at=now(), "user"=COALESCE("user", $3)
             WHERE tenant_id=$1 AND id=$2
          `, [tenantId, sessionIdRemote, userFinal || null]);

          // We could accumulate recap info to return, but push_ops returns mappings only.
          break;
        }

        /* ─────────────────────────────
         * PRODUITS
         * ────────────────────────────*/
        case 'product.created': {
          const mapping = await handleProductCreated(client, tenantId, p);
          if (mapping) {
            productMappings.push(mapping);
          }
          break;
        }

        case 'product.updated': {
          const remoteId = p.remote_id || null;
          const localId  = asIntOrNull(p.id);
          const reference = p.reference || null;

          const fields = [];
          const values = [tenantId];
          let idx = 1;

          if (p.nom != null) {
            fields.push(`nom = $${++idx}`);
            values.push(p.nom);
          }
          if (p.code_barre != null) {
            fields.push(`code_barre = $${++idx}`);
            values.push(p.code_barre);
          }
          if (p.prix != null) {
            fields.push(`prix = $${++idx}`);
            values.push(Number(p.prix));
          }
          if (p.stock != null) {
            fields.push(`stock = $${++idx}`);
            values.push(Number(p.stock));
          }
          if (!fields.length) {
            console.log('    [i] product.updated sans champs modifiés, rien à faire.');
            break;
          }

          let sql;
          if (remoteId) {
            values.push(remoteId);
            sql = `
              UPDATE produits
                 SET ${fields.join(', ')}, updated_at = now()
               WHERE tenant_id = $1 AND id = $${++idx}
            `;
          } else if (reference) {
            values.push(reference);
            sql = `
              UPDATE produits
                 SET ${fields.join(', ')}, updated_at = now()
               WHERE tenant_id = $1 AND reference = $${++idx}
            `;
          } else {
            console.log(
              '    [i] product.updated sans remote_id ni reference, ignorée côté Neon',
              { localId }
            );
            break;
          }

          await client.query(sql, values);
          console.log('    [~] produit mis à jour sur Neon', {
            localId,
            remoteId,
            reference,
          });
          break;
        }

        case 'product.deleted': {
          const remoteUuid = p.remote_uuid || null;
          const reference = p.reference || null;

          if (remoteUuid) {
            await client.query(
              `UPDATE produits SET deleted = true, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
              [tenantId, remoteUuid]
            );
            console.log('    [x] produit marqué supprimé sur Neon', { remoteUuid });
          } else if (reference) {
            await client.query(
              `UPDATE produits SET deleted = true, updated_at = now() WHERE tenant_id = $1 AND reference = $2`,
              [tenantId, reference]
            );
            console.log('    [x] produit marqué supprimé sur Neon', { reference });
          } else {
            console.log('    [i] product.deleted sans remote_uuid ni reference, ignorée');
          }
          break;
        }

        default:
          console.log('    [?] op ignorée', op.op_type);
          break;
      }

      try {
        await client.query(`UPDATE ops SET applied_at = now() WHERE id=$1`, [
          op.id,
        ]);
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }
    }

    await client.query('COMMIT');
    console.log('[API] /sync/push_ops done.');

    // Envoi des emails de facture si module actif
    console.log(`[EMAIL-FACTURE] Ventes créées: ${ventesCreees.length}`);
    if (ventesCreees.length > 0) {
      try {
        const modulesRes = await pool.query(
          `SELECT modules_json FROM tenant_settings WHERE tenant_id = $1`,
          [tenantId]
        );
        const modules = modulesRes.rows[0]?.modules_json || {};
        console.log('[EMAIL-FACTURE] Modules du tenant:', modules);
        const moduleEmailActif = modules.email || modules.emails || modules.email_facture;
        console.log('[EMAIL-FACTURE] Module email actif?', moduleEmailActif);
        
        if (moduleEmailActif) {
          console.log('[EMAIL-FACTURE] Module actif, chargement des dépendances...');
          const { getEmailSettings } = await import('./models/emailSettingsRepo.js');
          const nodemailer = await import('nodemailer');
          let emailSettings = await getEmailSettings(tenantId);
          
          console.log('[EMAIL-FACTURE] Config email_settings récupérée:', emailSettings ? 'OUI' : 'NON');
          
          // Fallback: si email_settings n'existe pas, utiliser email_admin_json
          if (!emailSettings || !emailSettings.enabled) {
            console.log('[EMAIL-FACTURE] Tentative fallback sur email_admin_json...');
            const adminEmailRes = await pool.query(
              `SELECT email_admin_json FROM tenant_settings WHERE tenant_id = $1`,
              [tenantId]
            );
            const adminEmailConfig = adminEmailRes.rows[0]?.email_admin_json || {};
            console.log('[EMAIL-FACTURE] Config email_admin_json récupérée:', Object.keys(adminEmailConfig).length > 0 ? 'OUI' : 'NON');
            
            if (adminEmailConfig && adminEmailConfig.provider && adminEmailConfig.provider !== 'disabled') {
              console.log('[EMAIL-FACTURE] Utilisation de email_admin_json, provider:', adminEmailConfig.provider);
              // Convertir le format email_admin_json vers le format email_settings
              emailSettings = {
                enabled: true,
                host: adminEmailConfig.host || 'smtp.gmail.com',
                port: adminEmailConfig.port || 587,
                secure: !!adminEmailConfig.secure,
                auth_user: adminEmailConfig.user,
                from_name: adminEmailConfig.from || adminEmailConfig.user,
                from_email: adminEmailConfig.from || adminEmailConfig.user,
                // Le mot de passe dans email_admin_json n'est pas chiffré
                auth_pass: adminEmailConfig.pass
              };
            }
          }
          
          console.log('[EMAIL-FACTURE] Email enabled?', emailSettings?.enabled);
          
          if (emailSettings && emailSettings.enabled) {
            console.log('[EMAIL-FACTURE] Configuration SMTP valide, création transporter...');
            
            // Gérer le mot de passe chiffré ou non chiffré
            let password = emailSettings.auth_pass;
            if (emailSettings.auth_pass_enc) {
              const { decryptSecret } = await import('./utils/crypto.js');
              password = decryptSecret(emailSettings.auth_pass_enc);
            }
            
            const transporter = nodemailer.default.createTransport({
              host: emailSettings.host,
              port: emailSettings.port,
              secure: !!emailSettings.secure,
              auth: {
                user: emailSettings.auth_user,
                pass: password
              }
            });

            // Import du template de facture
            const { generateFactureHTML } = await import('./utils/factureTemplate.js');

            for (const vente of ventesCreees) {
              console.log('[EMAIL-FACTURE] Traitement vente:', vente);
              
              // Récupérer les informations de l'adhérent
              let adherent = null;
              let emailDest = vente.clientEmail;
              if (vente.adherentUuid) {
                const adhRes = await pool.query(
                  `SELECT * FROM adherents WHERE tenant_id = $1 AND id = $2`,
                  [tenantId, vente.adherentUuid]
                );
                adherent = adhRes.rows[0] || null;
                if (!emailDest && adherent) {
                  emailDest = adherent.email1 || null;
                }
              }

              if (!emailDest) {
                console.log('[EMAIL-FACTURE] Aucun email destinataire trouvé pour cette vente');
                continue;
              }

              // Récupérer les détails de la vente (lignes)
              const lignesRes = await pool.query(
                `SELECT lv.*, p.nom as nom_produit, p.reference
                 FROM lignes_vente lv
                 LEFT JOIN produits p ON p.id = lv.produit_id AND p.tenant_id = $1
                 WHERE lv.vente_id = $2 AND lv.tenant_id = $1`,
                [tenantId, vente.venteUuid]
              );

              // Récupérer les infos du tenant et logo
              // Récupérer branding (logo binaire) + infos tenant
              let tenantInfo = {};
              try {
                const infoRes = await pool.query(
                  `SELECT company_name, logo_url FROM tenant_settings WHERE tenant_id = $1`,
                  [tenantId]
                );
                tenantInfo = infoRes.rows[0] || {};
                console.log('[EMAIL-FACTURE] tenant_settings loaded:', { company_name: tenantInfo.company_name, logo_url: tenantInfo.logo_url });
              } catch (e) {
                console.warn('[EMAIL-FACTURE] tenant_settings fetch failed:', e.message);
              }
              let brandingLogoBuf = null;
              let brandingLogoMime = null;
              try {
                const brandRes = await pool.query(
                  `SELECT logo_mime, logo_data FROM tenant_branding WHERE tenant_id = $1`,
                  [tenantId]
                );
                if (brandRes.rowCount > 0 && brandRes.rows[0].logo_data) {
                  brandingLogoBuf = brandRes.rows[0].logo_data;
                  brandingLogoMime = brandRes.rows[0].logo_mime || 'image/png';
                }
              } catch (e) {
                console.warn('[EMAIL-FACTURE] tenant_branding fetch failed:', e.message);
              }

              // Récupérer le mode de paiement
              let modePaiement = null;
              if (vente.modePaiementUuid) {
                const mpRes = await pool.query(
                  `SELECT nom FROM modes_paiement WHERE tenant_id = $1 AND id = $2`,
                  [tenantId, vente.modePaiementUuid]
                );
                modePaiement = mpRes.rows[0]?.nom || null;
              }

              // Générer le numéro de facture (format: YYYY-MM-XXXXXX)
              const now = new Date();
              const venteIdShort = vente.venteUuid.split('-')[0].toUpperCase();
              const numeroFacture = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${venteIdShort}`;

              // Construire le logo URL complet si nécessaire
              let logoCid = null;
              let attachments = [];
              let logoUrl = null; // HTML utilisera cid si dispo, sinon URL absolue
              if (brandingLogoBuf) {
                logoCid = 'tenantlogo';
                logoUrl = 'cid:tenantlogo';
                attachments.push({
                  filename: 'logo.png',
                  content: brandingLogoBuf,
                  contentType: brandingLogoMime,
                  cid: logoCid
                });
                console.log('[EMAIL-FACTURE] Logo CID attach prepared');
              } else {
                // Fallback: utiliser le logo_url si défini dans tenant_settings
                const raw = tenantInfo?.logo_url;
                if (raw) {
                  if (String(raw).startsWith('http')) {
                    // URL absolue externe: certains clients afficheront l'image distante
                    logoUrl = raw;
                    console.log('[EMAIL-FACTURE] Fallback logo_url (http) utilisé:', logoUrl);
                  } else {
                    // Logo local (ex: /public/logos/<tenant>.png) → embarquer inline (cid)
                    try {
                      const rel = String(raw).replace(/^[\\\/]+/, '');
                      const fullPath = path.join(__dirname, rel);
                      const ext = path.extname(fullPath).toLowerCase();
                      const ctype = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
                      const buf = fs.readFileSync(fullPath);
                      logoCid = 'tenantlogo';
                      logoUrl = 'cid:tenantlogo';
                      attachments.push({ filename: path.basename(fullPath), content: buf, contentType: ctype, cid: logoCid });
                      console.log('[EMAIL-FACTURE] Logo local ajouté en CID depuis logo_url:', fullPath);
                    } catch (e) {
                      // En dernier recours, tenter l'URL complète côté API (peut ne pas être accessible publiquement)
                      const apiUrl = process.env.API_URL || 'http://localhost:3001';
                      logoUrl = `${apiUrl}${raw}`;
                      console.warn('[EMAIL-FACTURE] Lecture logo local échouée, utilisation URL:', logoUrl, e?.message || e);
                    }
                  }
                } else {
                  console.log('[EMAIL-FACTURE] Aucun logo trouvé (branding ni logo_url), fallback nom entreprise');
                }
              }
              
              // Générer le HTML de la facture
              console.log('[EMAIL-FACTURE] Données facture:', {
                total: vente.total,
                fraisPaiement: vente.fraisPaiement,
                cotisation: vente.cotisation,
                acompte: vente.acompte,
                modePaiement,
                logoUrl
              });
              
              const factureHTML = generateFactureHTML({
                numeroFacture,
                dateFacture: now.toISOString(),
                tenant: tenantInfo,
                adherent,
                lignes: lignesRes.rows.map(l => {
                  const q = Number(l.quantite || 0) || 0;
                  const lineTotal = Number(l.prix || 0); // prix stocké = TOTAL de ligne
                  const unit = (q > 0)
                    ? (l.prix_unitaire != null && Number(l.prix_unitaire) > 0
                        ? Number(l.prix_unitaire)
                        : lineTotal / q)
                    : (l.prix_unitaire != null && Number(l.prix_unitaire) > 0 ? Number(l.prix_unitaire) : lineTotal);
                  return {
                    nom_produit: l.nom_produit || l.reference || 'Produit',
                    quantite: q,
                    prix_unitaire: unit,
                    total: lineTotal
                  };
                }),
                total: vente.total,
                fraisPaiement: vente.fraisPaiement || 0,
                cotisation: vente.cotisation || 0,
                acompte: vente.acompte || 0,
                modePaiement,
                logoUrl
              });

              console.log(`[EMAIL-FACTURE] Envoi email à ${emailDest}...`);
              transporter.sendMail({
                from: `${emailSettings.from_name} <${emailSettings.from_email}>`,
                to: emailDest,
                subject: `Votre facture #${numeroFacture}`,
                html: factureHTML,
                text: `Facture #${numeroFacture}\n\nMerci pour votre achat.\nMontant total : ${vente.total} €.\n\nLogo: ${logoCid ? 'inclus inline' : 'non fourni'}\n`,
                attachments
              }).then(() => {
                console.log(`✅ [EMAIL-FACTURE] Email envoyé avec succès à ${emailDest} pour vente #${vente.venteUuid}`);
              }).catch(e => {
                console.error('❌ [EMAIL-FACTURE] Erreur envoi email facture:', e);
              });
            }
          } else {
            console.log('[EMAIL-FACTURE] Config email manquante ou désactivée');
          }
        } else {
          console.log('[EMAIL-FACTURE] Module email_facture non actif');
        }
      } catch (e) {
        console.error('❌ [EMAIL-FACTURE] Erreur logique email facture:', e);
      }
    }

    // 🔁 On renvoie les mappings pour que le client mette à jour remote_uuid
    return res.json({
      ok: true,
      mappings: {
        produits: productMappings,
        inventory_sessions: sessionMappings,
        ventes: venteMappings,
        receptions: receptionMappings,
        fournisseurs: fournisseurMappings,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/push_ops error:', e);
    if (e?.code === '42P01') {
      return res.status(500).json({
        ok: false,
        error: 'missing_table',
        detail: e.message,
      });
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
    unites = [],
    familles = [],
    categories = [],
    adherents = [],
    fournisseurs = [],
    produits = [],
    modes_paiement = [],
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Unités
    for (const u of unites) {
      await client.query(
        `
        INSERT INTO unites (id, tenant_id, nom)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3)
        ON CONFLICT (tenant_id, nom) DO UPDATE
          SET nom = EXCLUDED.nom
        `,
        [asUuidOrNull(u.id), tenantId, u.nom]
      );
    }

    // Familles
    for (const f of familles) {
      await client.query(
        `
        INSERT INTO familles (id, tenant_id, nom)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3)
        ON CONFLICT (tenant_id, nom) DO UPDATE
          SET nom = EXCLUDED.nom
        `,
        [asUuidOrNull(f.id), tenantId, f.nom]
      );
    }

    // Catégories
    for (const c of categories) {
      await client.query(
        `
        INSERT INTO categories (id, tenant_id, nom, famille_id)
        VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4)
        ON CONFLICT (tenant_id, nom) DO UPDATE
          SET nom = EXCLUDED.nom,
              famille_id = COALESCE(EXCLUDED.famille_id, categories.famille_id)
        `,
        [asUuidOrNull(c.id), tenantId, c.nom, asUuidOrNull(c.famille_id)]
      );
    }

    // ⚠️ Adhérents
    // On ne bootstrap les adhérents que si le tenant n'en a pas déjà,
    // pour éviter les doublons à chaque nouveau bootstrap.
    const adhCountRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM adherents WHERE tenant_id=$1`,
      [tenantId]
    );
    const adhAlready = adhCountRes.rows[0]?.n || 0;

    if (adhAlready === 0 && adherents.length > 0) {
      console.log(
        `[bootstrap] insertion des adherents pour tenant=${tenantId}, count=${adherents.length}`
      );
      for (const a of adherents) {
        await client.query(
          `
          INSERT INTO adherents
           (id, tenant_id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
            nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
          VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id) DO UPDATE SET
            nom=$3, prenom=$4, email1=$5, email2=$6, telephone1=$7, telephone2=$8, adresse=$9, code_postal=$10, ville=$11,
            nb_personnes_foyer=$12, tranche_age=$13, droit_entree=$14, date_inscription=$15,
            archive=$16, date_archivage=$17, date_reactivation=$18
          `,
          [
            asUuidOrNull(a.id),
            tenantId,
            a.nom || null,
            a.prenom || null,
            a.email1 || null,
            a.email2 || null,
            a.telephone1 || null,
            a.telephone2 || null,
            a.adresse || null,
            a.code_postal || null,
            a.ville || null,
            a.nb_personnes_foyer || null,
            a.tranche_age || null,
            a.droit_entree || null,
            a.date_inscription || null,
            a.archive || null,
            a.date_archivage || null,
            a.date_reactivation || null,
          ]
        );
      }
    } else if (adhAlready > 0 && adherents.length > 0) {
      console.log(
        `[bootstrap] adherents ignorés pour tenant=${tenantId} (déjà ${adhAlready} en base)`
      );
    }

    // Fournisseurs
    for (const f of fournisseurs) {
      await client.query(
        `
        INSERT INTO fournisseurs
          (id, tenant_id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, label)
        VALUES
          (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (tenant_id, nom) DO UPDATE SET
          contact      = EXCLUDED.contact,
          email        = EXCLUDED.email,
          telephone    = EXCLUDED.telephone,
          adresse      = EXCLUDED.adresse,
          code_postal  = EXCLUDED.code_postal,
          ville        = EXCLUDED.ville,
          categorie_id = EXCLUDED.categorie_id,
          label        = EXCLUDED.label
        `,
        [
          asUuidOrNull(f.id),
          tenantId,
          f.nom,
          f.contact || null,
          f.email || null,
          f.telephone || null,
          f.adresse || null,
          f.code_postal || null,
          f.ville || null,
          asUuidOrNull(f.categorie_id),
          f.label || null,
        ]
      );
    }

    // Produits
    for (const p of produits) {
      const prodId = asIntOrNull(p.id);
      if (!prodId) {
        console.warn('[bootstrap] Produit ignoré car id invalide :', p);
        continue;
      }

      await client.query(
        `
        INSERT INTO produits
          (id, tenant_id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        ON CONFLICT (tenant_id, id) DO UPDATE SET
          nom          = EXCLUDED.nom,
          reference    = EXCLUDED.reference,
          prix         = EXCLUDED.prix,
          stock        = EXCLUDED.stock,
          code_barre   = EXCLUDED.code_barre,
          unite_id     = EXCLUDED.unite_id,
          fournisseur_id = EXCLUDED.fournisseur_id,
          categorie_id = EXCLUDED.categorie_id,
          updated_at   = now()
        `,
        [
          prodId,
          tenantId,
          p.nom,
          p.reference || `P-${String(prodId).padStart(6, '0')}`,
          Number(p.prix || 0),
          Number(p.stock ?? 0),
          p.code_barre || null,
          asUuidOrNull(p.unite_id),
          asUuidOrNull(p.fournisseur_id),
          asUuidOrNull(p.categorie_id),
        ]
      );
    }

    // Modes de paiement
    for (const mp of modes_paiement) {
      await client.query(
        `
        INSERT INTO modes_paiement
          (id, tenant_id, nom, taux_percent, frais_fixe, actif)
        VALUES
          (COALESCE($1::uuid, uuid_generate_v4()), $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, nom) DO UPDATE SET
          taux_percent = EXCLUDED.taux_percent,
          frais_fixe   = EXCLUDED.frais_fixe,
          actif        = EXCLUDED.actif
        `,
        [
          asUuidOrNull(mp.id),
          tenantId,
          String(mp.nom || '').trim(),
          Number(mp.taux_percent) || 0,
          Number(mp.frais_fixe) || 0,
          !!mp.actif,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      counts: {
        unites: unites.length,
        familles: familles.length,
        categories: categories.length,
        adherents: adherents.length,
        fournisseurs: fournisseurs.length,
        produits: produits.length,
        modes_paiement: modes_paiement.length,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/bootstrap error:', e);
    res.status(500).json({ ok: false, error: e.message });
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
      RETURNING *
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
 * Migration: Ajouter colonne deleted si elle n'existe pas
 * =======================*/
(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='produits' AND column_name='deleted'
        ) THEN
          ALTER TABLE produits ADD COLUMN deleted boolean NOT NULL DEFAULT false;
        END IF;
      END$$;
    `);
    console.log('[db] Migration: colonne "deleted" vérifiée/ajoutée');
  } catch (e) {
    console.error('[db] Migration error:', e.message);
  } finally {
    client.release();
  }
})();

/* =========================
 * 📊 ENDPOINT DE MONITORING
 * =======================*/
import { getStats, reset as resetPerfStats } from './middleware/performance.js';

app.get('/api/performance/stats', authRequired, (req, res) => {
  const stats = getStats();
  res.json({ ok: true, stats });
});

app.post('/api/performance/reset', authRequired, (req, res) => {
  resetPerfStats();
  res.json({ ok: true, message: 'Métriques réinitialisées' });
});

// Démarrer le rapport périodique (toutes les 10 minutes)
startPeriodicReport(10 * 60 * 1000);

/* =========================
 * Start server
 * =======================*/
const port = process.env.PORT || 3001;
app.listen(port, () => console.log('caisse-api listening on', port));
