// server.js

console.log('[API] build=no-mailer v1 (multi-tenant full)');

function asIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

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
import inventoryExtraRouter from './routes/inventory_extra.js';
import inventoryRoutes from './routes/inventory.js';

// Middleware
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
app.use(inventoryExtraRouter);
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

    const r = await client.query(
      `
      WITH summed AS (
         SELECT produit_id, SUM(qty)::numeric AS counted_total
         FROM inventory_counts
         WHERE tenant_id=$1 AND session_id=$2
         GROUP BY produit_id
       )
       SELECT
         p.id   AS product_id,
         p.nom,
         p.prix,
         COALESCE(s.counted_total, 0) AS counted_total
       FROM inventory_snapshot snap
       JOIN produits p
         ON p.id = snap.product_id
        AND p.tenant_id = snap.tenant_id
       LEFT JOIN summed s
         ON s.produit_id = snap.product_id
       WHERE snap.tenant_id=$1 AND snap.session_id=$2
       ORDER BY p.nom
      `,
      [tenantId, sessionId]
    );

    res.json({ ok: true, lines: r.rows });
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

async function applyFournisseurUpsert(client, tenantId, p = {}) {
  const nom = (p.nom || '').trim();
  if (!nom) return;

  await client.query(
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
}

async function applyFournisseurCreated(client, tenantId, p) {
  return applyFournisseurUpsert(client, tenantId, p);
}

async function applyFournisseurUpdated(client, tenantId, p) {
  return applyFournisseurUpsert(client, tenantId, p);
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
    const [unites, familles, categories, adherents, fournisseurs, produits, modes_paiement] =
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
      ]);

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
      },
    });
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

  const order = {
    'adherent.created': 1,
    'adherent.updated': 2,
    'fournisseur.created': 3,
    'fournisseur.updated': 4,
    'sale.created': 10,
    'sale.updated': 11,
  };

  ops.sort((a, b) => (order[a.op_type] || 100) - (order[b.op_type] || 100));

  const client = await pool.connect();
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

        /* ─────────────────────────────
         * FOURNISSEURS
         * ────────────────────────────*/
        case 'fournisseur.created': {
          await applyFournisseurCreated(client, tenantId, p);
          break;
        }

        case 'fournisseur.updated': {
          await applyFournisseurUpdated(client, tenantId, p);
          break;
        }

        /* ─────────────────────────────
         * VENTES
         * ────────────────────────────*/
        case 'sale.created': {
          const venteId = asIntOrNull(p.venteId);
          const mpId = asIntOrNull(p.modePaiementId);
          const adherentId = asIntOrNull(p.adherentId);

          await client.query(
            `
            INSERT INTO ventes (
               id, tenant_id, total, adherent_id, mode_paiement_id,
               sale_type, client_email, frais_paiement, cotisation
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id, id) DO NOTHING
            `,
            [
              venteId,
              tenantId,
              p.total ?? null,
              adherentId,
              mpId,
              p.saleType || 'adherent',
              p.clientEmail || null,
              p.fraisPaiement ?? null,
              p.cotisation ?? null,
            ]
          );
          console.log('    [+] vente header enregistrée id=', venteId);
          break;
        }

        case 'sale.line_added': {
          const venteId = asIntOrNull(p.venteId);
          const produitId = asIntOrNull(p.produitId);
          const ligneId = asIntOrNull(p.ligneId);

          if (!venteId) throw new Error('invalid_vente_id_int');
          if (!produitId) throw new Error('invalid_produit_id_int');

          const quantite = Number(p.quantite || 0);
          const prix = Number(p.prix || 0);

          const sourceKey =
            ligneId != null
              ? `lv:${ligneId}`
              : `sale:${venteId}:${produitId}:${quantite}:${prix}`;

          const checkProd = await client.query(
            `SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`,
            [tenantId, produitId]
          );
          if (checkProd.rowCount === 0)
            throw new Error('product_not_found_for_tenant');

          const checkVente = await client.query(
            `SELECT 1 FROM ventes WHERE tenant_id=$1 AND id=$2`,
            [tenantId, venteId]
          );
          if (checkVente.rowCount === 0)
            throw new Error('sale_not_found_for_tenant');

          const chk = await client.query(
            `
            SELECT 1 FROM lignes_vente
             WHERE tenant_id=$1 AND vente_id=$2 AND produit_id=$3 AND quantite=$4 AND prix=$5
             LIMIT 1
            `,
            [tenantId, venteId, produitId, quantite, prix]
          );

          if (chk.rowCount === 0) {
            if (ligneId != null) {
              await client.query(
                `
                INSERT INTO lignes_vente
                   (id, tenant_id, vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (tenant_id, id) DO NOTHING
                `,
                [
                  ligneId,
                  tenantId,
                  venteId,
                  produitId,
                  quantite,
                  prix,
                  p.prixUnitaire ?? null,
                  p.remisePercent ?? 0,
                ]
              );
            } else {
              await client.query(
                `
                INSERT INTO lignes_vente
                   (tenant_id, vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                `,
                [
                  tenantId,
                  venteId,
                  produitId,
                  quantite,
                  prix,
                  p.prixUnitaire ?? null,
                  p.remisePercent ?? 0,
                ]
              );
            }
            console.log(
              '    [+] ligne_vente ajoutée vente=',
              venteId,
              'prod=',
              produitId,
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
            [tenantId, produitId, -quantite, sourceKey]
          );
          console.log('    [+] stock_movements sale_line', {
            produit_id: produitId,
            delta: -quantite,
          });
          break;
        }

        /* ─────────────────────────────
         * RÉCEPTIONS
         * ────────────────────────────*/
        case 'reception.line_added': {
          console.log('  → reception.line_added payload:', p);

          const pid = Number(p.produitId);
          const qte = Number(p.quantite || 0);

          if (!Number.isInteger(pid) || pid <= 0) {
            console.warn(
              '    [!] reception.line_added ignorée — produitId invalide',
              p.produitId
            );
            break;
          }

          const chkP = await client.query(
            `SELECT 1 FROM produits WHERE tenant_id=$1 AND id=$2`,
            [tenantId, pid]
          );
          if (chkP.rowCount === 0) {
            console.warn(
              '    [!] reception.line_added ignorée — produit inconnu pour tenant',
              { tenantId, pid }
            );
            break;
          }

          let rid = p.receptionId != null ? Number(p.receptionId) : null;
          const fournisseurId =
            p.fournisseurId != null ? Number(p.fournisseurId) : null;

          if (rid && Number.isInteger(rid) && rid > 0) {
            const chkR = await client.query(
              `SELECT 1 FROM receptions WHERE tenant_id=$1 AND id=$2`,
              [tenantId, rid]
            );
            if (chkR.rowCount === 0) {
              await client.query(
                `
                INSERT INTO receptions (id, tenant_id, fournisseur_id, date, reference)
                 VALUES ($1, $2, $3, now(), $4)
                 ON CONFLICT (id) DO NOTHING
                `,
                [rid, tenantId, fournisseurId, p.reference || null]
              );
            }
          } else {
            const ins = await client.query(
              `
              INSERT INTO receptions (tenant_id, fournisseur_id, date, reference)
               VALUES ($1,$2, now(), $3)
               RETURNING id
              `,
              [tenantId, fournisseurId, p.reference || null]
            );
            rid = ins.rows[0].id;
          }

          const ligneRecId =
            p.ligneRecId != null ? Number(p.ligneRecId) : null;

          if (ligneRecId && Number.isInteger(ligneRecId) && ligneRecId > 0) {
            await client.query(
              `
              INSERT INTO lignes_reception (id, tenant_id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO UPDATE SET
                 reception_id  = EXCLUDED.reception_id,
                 produit_id    = EXCLUDED.produit_id,
                 quantite      = EXCLUDED.quantite,
                 prix_unitaire = EXCLUDED.prix_unitaire
              `,
              [ligneRecId, tenantId, rid, pid, qte, p.prixUnitaire ?? null]
            );
          } else {
            await client.query(
              `
              INSERT INTO lignes_reception (tenant_id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1,$2,$3,$4,$5)
              `,
              [tenantId, rid, pid, qte, p.prixUnitaire ?? null]
            );
          }

          const currentStock = await getCurrentStock(client, tenantId, pid);
          const stockCorrige =
            p.stockCorrige !== undefined && p.stockCorrige !== null
              ? Number(p.stockCorrige)
              : null;
          const base =
            stockCorrige !== null && !Number.isNaN(stockCorrige)
              ? stockCorrige
              : currentStock;
          const target = base + qte;
          const delta = target - currentStock;

          await client.query(
            `
            INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'reception_line',$4)
             ON CONFLICT DO NOTHING
            `,
            [tenantId, pid, delta, String(ligneRecId || `${rid}:${pid}`)]
          );
          console.log('    [+] stock_movements reception_line', {
            produit_id: pid,
            delta,
          });

          if (p.prixUnitaire != null) {
            await client.query(
              `
              UPDATE produits
                 SET prix = $1, updated_at = now()
               WHERE tenant_id = $2 AND id = $3
              `,
              [p.prixUnitaire, tenantId, pid]
            );
            console.log('    [~] prix produit mis à jour', {
              produit_id: pid,
              prix: p.prixUnitaire,
            });
          }

          break;
        }

        /* ─────────────────────────────
         * INVENTAIRE / PRODUITS
         * ────────────────────────────*/
        case 'inventory.adjust': {
          const produitId = asIntOrNull(p.produitId);
          const delta = Number(p.delta || 0);
          if (!produitId || !Number.isFinite(delta) || delta === 0) {
            console.warn(
              '    [!] inventory.adjust ignorée — produitId/delta invalide'
            );
            break;
          }
          await client.query(
            `
            INSERT INTO stock_movements (tenant_id, produit_id, delta, source, source_id)
             VALUES ($1,$2,$3,'inventory_adjust',$4)
             ON CONFLICT DO NOTHING
            `,
            [tenantId, produitId, delta, String(op.id)]
          );
          console.log('    [+] stock_movements inventory_adjust', {
            produit_id: produitId,
            delta,
          });
          break;
        }

        case 'product.created': {
          const id = asIntOrNull(p.local_id ?? p.id);
          if (!id) {
            console.warn(
              '    [!] product.created ignorée — id manquant ou invalide',
              p
            );
            break;
          }

          await client.query(
            `
            INSERT INTO produits
              (id, tenant_id, nom, reference, prix, stock, code_barre,
               unite_id, fournisseur_id, categorie_id, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
            ON CONFLICT (tenant_id, id) DO UPDATE SET
              nom           = EXCLUDED.nom,
              reference     = EXCLUDED.reference,
              prix          = EXCLUDED.prix,
              stock         = EXCLUDED.stock,
              code_barre    = EXCLUDED.code_barre,
              unite_id      = EXCLUDED.unite_id,
              fournisseur_id= EXCLUDED.fournisseur_id,
              categorie_id  = EXCLUDED.categorie_id,
              updated_at    = now()
            `,
            [
              id,
              tenantId,
              p.nom ?? null,
              p.reference ?? null,
              Number(p.prix ?? 0),
              Number(p.stock ?? 0),
              p.code_barre ?? null,
              asUuidOrNull(p.unite_id),
              asUuidOrNull(p.fournisseur_id),
              asUuidOrNull(p.categorie_id),
            ]
          );
          console.log('    [+] produit créé/mis à jour', { id });
          break;
        }

        case 'product.updated': {
          const fields = [];
          const values = [];
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
            values.push(p.prix);
          }
          if (p.categorie_id != null) {
            fields.push(`categorie_id = $${++idx}`);
            values.push(asUuidOrNull(p.categorie_id));
          }
          if (p.unite_id != null) {
            fields.push(`unite_id = $${++idx}`);
            values.push(asUuidOrNull(p.unite_id));
          }
          if (p.fournisseur_id != null) {
            fields.push(`fournisseur_id = $${++idx}`);
            values.push(asUuidOrNull(p.fournisseur_id));
          }

          if (fields.length > 0) {
            const sql = `
              UPDATE produits
                 SET ${fields.join(', ')}, updated_at = now()
               WHERE tenant_id = $1 AND id = $2
            `;
            await client.query(sql, [tenantId, asIntOrNull(p.id), ...values]);
            console.log('    [~] produit mis à jour', { id: p.id });
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
    res.json({ ok: true });
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
 * Start server
 * =======================*/
const port = process.env.PORT || 3001;
app.listen(port, () => console.log('caisse-api listening on', port));
