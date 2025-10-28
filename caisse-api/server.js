// server.js

console.log('[API] build=no-mailer v1');

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute-le dans .env');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ------------ Health ------------ */
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/health/db', async (_req, res) => {
  try {
    const r = await pool.query('select current_database() as db, current_user as usr');
    res.json({ ok: true, db: r.rows[0].db, usr: r.rows[0].usr });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ------------ Helper: stock actuel ------------ */
async function getCurrentStock(client, productId) {
  const r = await client.query(
    `SELECT COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements WHERE product_id=$1), p.stock, 0)::numeric AS stock
     FROM produits p WHERE p.id=$1`,
    [productId]
  );
  return Number(r.rows[0]?.stock || 0);
}

/* =========================================================
 * INVENTAIRE
 * =======================================================*/

app.post('/inventory/start', async (req, res) => {
  const { name, user, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'name_required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, name, status, started_at FROM inventory_sessions
       WHERE name=$1 AND status='open'
       ORDER BY id ASC LIMIT 1`,
      [name]
    );
    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({ ok:true, session: existing.rows[0], reused: true });
    }

    const s = await client.query(
      `INSERT INTO inventory_sessions(name, "user", notes)
       VALUES ($1,$2,$3) RETURNING id, name, status, started_at`,
      [name, user || null, notes || null]
    );
    const sessionId = s.rows[0].id;

    // Snapshot des stocks au démarrage (pour le reporting)
    const prods = await client.query(`SELECT id, prix FROM produits ORDER BY id`);
    for (const p of prods.rows) {
      const stockStart = await getCurrentStock(client, p.id);
      await client.query(
        `INSERT INTO inventory_snapshot(session_id, product_id, stock_start, unit_cost)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id, product_id) DO NOTHING`,
        [sessionId, p.id, stockStart, null]
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

app.post('/inventory/:id/count-add', async (req, res) => {
  console.log('[API] count-add params:', req.params);
  console.log('[API] count-add body:', req.body);

  const sessionIdRaw = req.params.id;
  const productIdRaw = req.body?.product_id;
  const qtyRaw       = req.body?.qty;
  const deviceId     = req.body?.device_id;
  const user         = req.body?.user || null;

  const sessionId = Number(sessionIdRaw);
  const productId = Number(productIdRaw);
  const qty       = Number(qtyRaw);

  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ ok:false, error:'bad_session_id', detail: { sessionIdRaw } });
  }
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ ok:false, error:'bad_product_id', detail: { productIdRaw } });
  }
  if (!Number.isFinite(qty)) {
    return res.status(400).json({ ok:false, error:'bad_qty', detail: { qtyRaw } });
  }
  if (!deviceId || typeof deviceId !== 'string') {
    return res.status(400).json({ ok:false, error:'device_id_required' });
  }

  const client = await pool.connect();
  try {
    const st = await client.query(
      `SELECT status FROM inventory_sessions WHERE id=$1`,
      [sessionId]
    );
    if (st.rowCount === 0) return res.status(404).json({ ok:false, error:'session_not_found' });
    if (st.rows[0].status !== 'open') return res.status(409).json({ ok:false, error:'session_locked' });

    await client.query(
      `INSERT INTO inventory_counts(session_id, product_id, device_id, "user", qty, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (session_id, product_id, device_id)
       DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, updated_at=now()`,
      [sessionId, productId, deviceId, user, qty]
    );

    return res.json({ ok:true });
  } catch (e) {
    console.error('POST /inventory/:id/count-add', e);
    return res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// Liste des sessions
app.get('/inventory/sessions', async (_req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      WITH cnt AS (
        SELECT session_id, product_id, SUM(qty)::numeric AS counted
        FROM inventory_counts
        GROUP BY session_id, product_id
      )
      SELECT
        s.id, s.name, s.status, s.started_at, s.ended_at,
        COUNT(sn.product_id)::int AS total_products,
        SUM(CASE WHEN COALESCE(c.counted,0) <> 0 THEN 1 ELSE 0 END)::int AS counted_lines,
        COALESCE(SUM(COALESCE(c.counted,0) * COALESCE(p.prix,0)),0)::numeric AS inventory_value
      FROM inventory_sessions s
      JOIN inventory_snapshot sn ON sn.session_id = s.id
      JOIN produits p ON p.id = sn.product_id
      LEFT JOIN cnt c ON c.session_id = s.id AND c.product_id = sn.product_id
      GROUP BY s.id
      ORDER BY s.started_at DESC
    `);
    res.json({ ok: true, sessions: r.rows });
  } catch (e) {
    console.error('GET /inventory/sessions', e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// Résumé d'une session : totaux comptés par produit
app.get('/inventory/:id/summary', async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ ok:false, error:'bad_session_id' });
  }

  const client = await pool.connect();
  try {
    // Vérifie que la session existe
    const s = await client.query(`SELECT id FROM inventory_sessions WHERE id=$1`, [sessionId]);
    if (s.rowCount === 0) {
      return res.status(404).json({ ok:false, error:'session_not_found' });
    }

    // Agrégat des comptages par produit + prix produit pour le calcul de valeur
    const r = await client.query(
      `WITH summed AS (
         SELECT product_id, SUM(qty)::numeric AS counted_total
         FROM inventory_counts
         WHERE session_id=$1
         GROUP BY product_id
       )
       SELECT
         p.id   AS product_id,
         p.nom,
         p.prix,
         COALESCE(s.counted_total, 0) AS counted_total
       FROM inventory_snapshot snap
       JOIN produits p ON p.id = snap.product_id
       LEFT JOIN summed s ON s.product_id = snap.product_id
       WHERE snap.session_id=$1
       ORDER BY p.id`,
      [sessionId]
    );

    res.json({ ok:true, lines: r.rows });
  } catch (e) {
    console.error('GET /inventory/:id/summary', e);
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});


// Clôture
app.post('/inventory/:id/finalize', async (req, res) => {
  const sessionId = Number(req.params.id);
  const { user } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const st = await client.query(
      `SELECT id, status, name, started_at FROM inventory_sessions WHERE id=$1 FOR UPDATE`,
      [sessionId]
    );
    if (st.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ ok:false, error:'session_not_found' }); }
    if (st.rows[0].status !== 'open') { await client.query('ROLLBACK'); return res.status(409).json({ ok:false, error:'session_locked' }); }

    await client.query(`UPDATE inventory_sessions SET status='finalizing' WHERE id=$1`, [sessionId]);

    const agg = await client.query(
      `WITH summed AS (
         SELECT product_id, SUM(qty)::numeric AS counted
         FROM inventory_counts
         WHERE session_id=$1
         GROUP BY product_id
       )
       SELECT p.id AS product_id, p.nom, p.code_barre, p.prix,
              s.stock_start, COALESCE(sm.counted, 0) AS counted_total
       FROM inventory_snapshot s
       JOIN produits p ON p.id = s.product_id
       LEFT JOIN summed sm ON sm.product_id = s.product_id
       WHERE s.session_id=$1
       ORDER BY p.id`,
      [sessionId]
    );

    let linesInserted = 0, countedProducts = 0, inventoryValue = 0;

    for (const r of agg.rows) {
      const pid     = Number(r.product_id);
      const start   = Number(r.stock_start);
      const counted = Number(r.counted_total);
      const prix    = Number(r.prix || 0);

      const cur = await client.query(
        `SELECT COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements WHERE product_id=$1), p.stock, 0)::numeric AS stock
         FROM produits p WHERE p.id=$1`,
        [pid]
      );
      const currentLive = Number(cur.rows[0]?.stock || 0);
      const delta = counted - currentLive;

      await client.query(
        `INSERT INTO inventory_adjust(session_id, product_id, stock_start, counted_total, delta, unit_cost, delta_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sessionId, pid, start, counted, delta, null, delta * prix]
      );
      linesInserted++;

      if (counted !== 0) countedProducts++;
      inventoryValue += counted * prix;

      if (delta !== 0) {
        await client.query(
          `INSERT INTO stock_movements(product_id, source_type, source_id, qty_change)
           VALUES ($1,'inventory_finalize',$2,$3)
           ON CONFLICT (source_type, source_id) DO NOTHING`,
          [pid, `inv:${sessionId}:${pid}`, delta]
        );
      }
    }

    const endUpd = await client.query(
      `UPDATE inventory_sessions
         SET status='closed', ended_at=now(), "user"=COALESCE("user",$2)
       WHERE id=$1
       RETURNING id, name, started_at, ended_at`,
      [sessionId, user || null]
    );

    await client.query('COMMIT');

    const sess = endUpd.rows[0];
    const recap = {
      session: { id: sess.id, name: sess.name, started_at: sess.started_at, ended_at: sess.ended_at },
      stats: { linesInserted, countedProducts, inventoryValue }
    };

    res.json({ ok:true, recap });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/:id/finalize', e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

/* =========================================================
 * SYNC (bootstrap/pull/push_ops)
 * =======================================================*/

app.get('/sync/bootstrap_needed', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM produits`);
    res.json({ ok: true, needed: (r.rows[0].n === 0) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, needed: true });
  }
});

app.get('/sync/pull_refs', async (_req, res) => {
  const client = await pool.connect();
  try {
    const [
      unites, familles, categories, adherents, fournisseurs, produits, modes_paiement
    ] = await Promise.all([
      client.query(`SELECT id, nom FROM unites ORDER BY id`),
      client.query(`SELECT id, nom FROM familles ORDER BY id`),
      client.query(`SELECT id, nom, famille_id FROM categories ORDER BY id`),
      client.query(`SELECT * FROM adherents ORDER BY id`),
      client.query(`SELECT * FROM fournisseurs ORDER BY id`),
      client.query(`
        SELECT
          p.id, p.nom, p.reference, p.prix, p.code_barre, p.unite_id, p.fournisseur_id, p.categorie_id, p.updated_at,
          COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements sm WHERE sm.product_id = p.id), p.stock, 0) AS stock
        FROM produits p
        ORDER BY p.id
      `),
      client.query(`SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`)
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

app.post('/sync/push_ops', async (req, res) => {
  const { deviceId, ops } = req.body || {};
  if (!deviceId || !Array.isArray(ops)) {
    return res.status(400).json({ ok: false, error: 'Bad payload' });
  }

  console.log('[API] /sync/push_ops received:', { deviceId, count: ops.length });

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

      await client.query(
        `INSERT INTO ops (id, device_id, op_type, entity_type, entity_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, deviceId, op.op_type, op.entity_type || null, String(op.entity_id || ''), JSON.stringify(payloadObj)]
      );

      const r = await client.query(`SELECT applied_at, payload FROM ops WHERE id = $1`, [op.id]);
      if (r.rows[0]?.applied_at) { 
        console.log('    (déjà appliquée)'); 
        continue; 
      }

      let p = r.rows[0]?.payload;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
      if (!p || typeof p !== 'object') p = {};

      switch (op.op_type) {
        case 'sale.created': {
          let mpId = (p.modePaiementId ?? null);
          if (mpId != null) {
            const chk = await client.query(`SELECT 1 FROM modes_paiement WHERE id=$1`, [mpId]);
            if (chk.rowCount === 0) mpId = null;
          }
          let adherentId = (p.adherentId ?? null);
          if (adherentId != null) {
            const chkA = await client.query(`SELECT 1 FROM adherents WHERE id=$1`, [adherentId]);
            if (chkA.rowCount === 0) adherentId = null;
          }

          await client.query(
            `INSERT INTO ventes (id, total, adherent_id, mode_paiement_id, sale_type, client_email, frais_paiement, cotisation)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id) DO NOTHING`,
            [
              p.venteId || null,
              p.total || null,
              adherentId,
              mpId,
              p.saleType || 'adherent',
              p.clientEmail || null,
              p.fraisPaiement ?? null,
              p.cotisation ?? null,
            ]
          );
          console.log('    [+] vente header enregistrée id=', p.venteId);
          break;
        }

        case 'sale.line_added': {
          const sourceKey =
            (p.ligneId != null && p.ligneId !== '')
              ? `lv:${p.ligneId}`
              : `sale:${p.venteId}:${p.produitId}:${Number(p.quantite)}:${Number(p.prix)}`;

          const chk = await client.query(
            `SELECT 1 FROM lignes_vente WHERE vente_id=$1 AND produit_id=$2 AND quantite=$3 AND prix=$4 LIMIT 1`,
            [p.venteId, p.produitId, p.quantite, p.prix]
          );
          if (chk.rowCount === 0) {
            await client.query(
              `INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [p.venteId, p.produitId, p.quantite, p.prix, p.prixUnitaire ?? null, p.remisePercent ?? 0]
            );
            console.log('    [+] ligne_vente ajoutée vente=', p.venteId, 'prod=', p.produitId, 'qte=', p.quantite);
          } else {
            console.log('    [=] ligne_vente déjà présente');
          }

          await client.query(
            `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
             VALUES ($1,'sale_line',$2,$3)
             ON CONFLICT (source_type, source_id) DO NOTHING`,
            [p.produitId, sourceKey, -Number(p.quantite || 0)]
          );
          console.log('    [+] stock_movements sale_line', { product_id: p.produitId, qty: -Number(p.quantite || 0), sourceKey });
          break;
        }

        case 'reception.line_added': {
          const pid = Number(p.produitId);
          let rid = p.receptionId ? Number(p.receptionId) : null;

          if (rid) {
            const chk = await client.query(`SELECT 1 FROM receptions WHERE id=$1`, [rid]);
            if (chk.rowCount === 0) {
              await client.query(
                `INSERT INTO receptions (id, fournisseur_id, date, reference)
                 VALUES ($1,$2, now(), $3)
                 ON CONFLICT (id) DO NOTHING`,
                [rid, p.fournisseurId || null, p.reference || null]
              );
            }
          } else {
            const ins = await client.query(
              `INSERT INTO receptions (fournisseur_id, date, reference)
               VALUES ($1, now(), $2)
               RETURNING id`,
              [p.fournisseurId || null, p.reference || null]
            );
            rid = ins.rows[0].id;
          }

          if (p.ligneRecId != null && p.ligneRecId !== '') {
            await client.query(
              `INSERT INTO lignes_reception (id, reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (id) DO UPDATE SET
                 reception_id=EXCLUDED.reception_id,
                 produit_id=EXCLUDED.produit_id,
                 quantite=EXCLUDED.quantite,
                 prix_unitaire=EXCLUDED.prix_unitaire`,
              [Number(p.ligneRecId), rid, pid, Number(p.quantite), p.prixUnitaire ?? null]
            );
          } else {
            await client.query(
              `INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire)
               VALUES ($1,$2,$3,$4)`,
              [rid, pid, Number(p.quantite), p.prixUnitaire ?? null]
            );
          }

          const cur = await client.query(
            `SELECT COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements WHERE product_id=$1), p.stock, 0)::numeric AS stock
             FROM produits p WHERE p.id=$1`,
            [pid]
          );
          const currentStock = Number(cur.rows[0]?.stock || 0);
          const qte = Number(p.quantite || 0);
          const stockCorrige = (p.stockCorrige !== undefined && p.stockCorrige !== null) ? Number(p.stockCorrige) : null;
          const base = (stockCorrige !== null && !Number.isNaN(stockCorrige)) ? stockCorrige : currentStock;
          const target = base + qte;
          const delta = target - currentStock;

          await client.query(
            `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
             VALUES ($1,'reception_line',$2,$3)
             ON CONFLICT (source_type, source_id) DO NOTHING`,
            [pid, String(p.ligneRecId || `${rid}:${pid}`), delta]
          );
          console.log('    [+] stock_movements reception_line', { product_id: pid, delta });

          if (p.prixUnitaire != null) {
            await client.query(`UPDATE produits SET prix = $1, updated_at = now() WHERE id = $2`, [p.prixUnitaire, pid]);
            console.log('    [~] prix produit mis à jour', { product_id: pid, prix: p.prixUnitaire });
          }
          break;
        }

        case 'inventory.adjust': {
          await client.query(
            `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
             VALUES ($1,'inventory_adjust',$2,$3)
             ON CONFLICT (source_type, source_id) DO NOTHING`,
            [p.produitId, String(op.id), Number(p.delta || 0)]
          );
          console.log('    [+] stock_movements inventory_adjust', { product_id: p.produitId, delta: Number(p.delta || 0) });
          break;
        }

        case 'stock.set': {
          const pid = Number(p.productId);
          const desired = Number(p.newStock);
          if (Number.isFinite(pid) && Number.isFinite(desired)) {
            const cur = await client.query(
              `SELECT COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements WHERE product_id=$1), p.stock, 0)::numeric AS stock
               FROM produits p WHERE p.id=$1`,
              [pid]
            );
            const currentStock = Number(cur.rows[0]?.stock || 0);
            const delta = desired - currentStock;

            await client.query(
              `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
               VALUES ($1,'stock_set',$2,$3)
               ON CONFLICT (source_type, source_id) DO NOTHING`,
              [pid, String(op.id), delta]
            );
            console.log('    [+] stock_movements stock_set', { product_id: pid, delta });
          }
          break;
        }

        case 'product.updated': {
          const fields = [];
          const values = [];
          let idx = 1;

          if (p.nom != null)           { fields.push(`nom = $${++idx}`);         values.push(p.nom); }
          if (p.reference != null)     { fields.push(`reference = $${++idx}`);   values.push(p.reference); }
          if (p.code_barre != null)    { fields.push(`code_barre = $${++idx}`);  values.push(p.code_barre); }
          if (p.prix != null)          { fields.push(`prix = $${++idx}`);        values.push(p.prix); }
          if (p.categorie_id != null)  { fields.push(`categorie_id = $${++idx}`);values.push(p.categorie_id); }
          if (p.unite_id != null)      { fields.push(`unite_id = $${++idx}`);    values.push(p.unite_id); }
          if (p.fournisseur_id != null){ fields.push(`fournisseur_id=$${++idx}`);values.push(p.fournisseur_id); }

          if (fields.length > 0) {
            const sql = `UPDATE produits SET ${fields.join(', ')}, updated_at = now() WHERE id = $1`;
            await client.query(sql, [p.id, ...values]);
            console.log('    [~] produit mis à jour', { id: p.id });
          }
          break;
        }

        default:
          console.log('    [?] op ignorée', op.op_type);
          break;
      }

      await client.query(`UPDATE ops SET applied_at = now() WHERE id=$1`, [op.id]);
    }

    await client.query('COMMIT');
    console.log('[API] /sync/push_ops done.');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/push_ops error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/* Bootstrap (push TOUT local → Neon) */
app.post('/sync/bootstrap', async (req, res) => {
  const {
    unites = [], familles = [], categories = [], adherents = [],
    fournisseurs = [], produits = [], modes_paiement = []
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of unites) await client.query(
      `INSERT INTO unites (id, nom) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom`,
      [u.id, u.nom]
    );

    for (const f of familles) await client.query(
      `INSERT INTO familles (id, nom) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom`,
      [f.id, f.nom]
    );

    for (const c of categories) await client.query(
      `INSERT INTO categories (id, nom, famille_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET
         nom = EXCLUDED.nom,
         famille_id = COALESCE(EXCLUDED.famille_id, categories.famille_id)`,
      [c.id, c.nom, c.famille_id ?? null]
    );

    for (const a of adherents) await client.query(
      `INSERT INTO adherents
       (id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
        nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         nom=$2, prenom=$3, email1=$4, email2=$5, telephone1=$6, telephone2=$7, adresse=$8, code_postal=$9, ville=$10,
         nb_personnes_foyer=$11, tranche_age=$12, droit_entree=$13, date_inscription=$14, archive=$15, date_archivage=$16, date_reactivation=$17`,
      [
        a.id, a.nom, a.prenom, a.email1, a.email2, a.telephone1, a.telephone2, a.adresse, a.code_postal, a.ville,
        a.nb_personnes_foyer, a.tranche_age, a.droit_entree, a.date_inscription, a.archive, a.date_archivage, a.date_reactivation
      ]
    );

    for (const f of fournisseurs) await client.query(
      `INSERT INTO fournisseurs
       (id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         nom=$2, contact=$3, email=$4, telephone=$5, adresse=$6, code_postal=$7, ville=$8, categorie_id=$9, referent_id=$10, label=$11`,
      [
        f.id, f.nom, f.contact, f.email, f.telephone, f.adresse, f.code_postal, f.ville,
        f.categorie_id || null, f.referent_id || null, f.label || null
      ]
    );

    for (const p of produits) await client.query(
      `INSERT INTO produits
       (id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (id) DO UPDATE SET
         nom=$2, reference=$3, prix=$4, stock=$5, code_barre=$6,
         unite_id=$7, fournisseur_id=$8, categorie_id=$9, updated_at=now()`,
      [
        p.id, p.nom, p.reference, p.prix, p.stock ?? 0, p.code_barre || null,
        p.unite_id || null, p.fournisseur_id || null, p.categorie_id || null
      ]
    );

    for (const m of modes_paiement) {
      await client.query(
        `INSERT INTO modes_paiement (id, nom, taux_percent, frais_fixe, actif)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           nom=$2, taux_percent=$3, frais_fixe=$4, actif=$5`,
        [m.id, m.nom, m.taux_percent || 0, m.frais_fixe || 0, !!m.actif]
      );
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

/* Backfill mouvements à partir de produits.stock (legacy) */
app.post('/admin/backfill_stock', async (_req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      WITH to_seed AS (
        SELECT id AS product_id, COALESCE(stock, 0) AS qty
        FROM produits p
        WHERE NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)
          AND COALESCE(stock, 0) <> 0
      )
      INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
      SELECT ts.product_id, 'bootstrap', 'bootstrap:'||ts.product_id::text, ts.qty
      FROM to_seed ts
      ON CONFLICT (source_type, source_id) DO NOTHING
      RETURNING *;
    `);
    res.json({ ok: true, inserted: r.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log('caisse-api listening on', port));
