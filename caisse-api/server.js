// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';

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

/* ────────────────────────────── Mailer (optionnel) ───────────────────────────── */

let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

/* ────────────────────────────── Health ───────────────────────────── */

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/health/db', async (_req, res) => {
  try {
    const r = await pool.query('select current_database() as db, current_user as usr');
    res.json({ ok: true, db: r.rows[0].db, usr: r.rows[0].usr });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ────────────────────────────── Helpers ───────────────────────────── */

async function getCurrentStock(client, productId) {
  const r = await client.query(
    `SELECT COALESCE((SELECT SUM(qty_change)::numeric FROM stock_movements WHERE product_id=$1), p.stock, 0)::numeric AS stock
     FROM produits p WHERE p.id=$1`,
    [productId]
  );
  return Number(r.rows[0]?.stock || 0);
}

async function neonAdherentExists(client, id) {
  if (!id) return false;
  const r = await client.query('SELECT 1 FROM adherents WHERE id=$1', [id]);
  return r.rowCount > 0;
}

/* ────────────────────────────── INVENTAIRE ───────────────────────────── */

app.post('/inventory/start', async (req, res) => {
  const { name, user, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, name, status, started_at FROM inventory_sessions
       WHERE name=$1 AND status='open'
       ORDER BY id ASC
       LIMIT 1`,
      [name]
    );

    if (existing.rowCount > 0) {
      await client.query('COMMIT');
      return res.json({ ok: true, session: existing.rows[0], reused: true });
    }

    const s = await client.query(
      `INSERT INTO inventory_sessions(name, "user", notes)
       VALUES ($1,$2,$3) RETURNING id, name, status, started_at`,
      [name, user || null, notes || null]
    );
    const sessionId = s.rows[0].id;

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
    res.json({ ok: true, session: s.rows[0], reused: false });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/start', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/inventory/:id/count-add', async (req, res) => {
  const sessionId = Number(req.params.id);
  const { product_id, qty, device_id, user } = req.body || {};
  if (!Number.isFinite(sessionId) || !Number.isFinite(product_id) || !Number.isFinite(qty) || !device_id) {
    return res.status(400).json({ ok: false, error: 'bad_payload' });
  }

  const client = await pool.connect();
  try {
    const st = await client.query(`SELECT status FROM inventory_sessions WHERE id=$1`, [sessionId]);
    if (st.rowCount === 0) return res.status(404).json({ ok: false, error: 'session_not_found' });
    if (st.rows[0].status !== 'open') return res.status(409).json({ ok: false, error: 'session_locked' });

    await client.query(
      `INSERT INTO inventory_counts(session_id, product_id, device_id, "user", qty, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (session_id, product_id, device_id)
       DO UPDATE SET qty = inventory_counts.qty + EXCLUDED.qty, updated_at=now()`,
      [sessionId, product_id, device_id, user || null, qty]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('POST /inventory/:id/count-add', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get('/inventory/:id/summary', async (req, res) => {
  const sessionId = Number(req.params.id);
  const client = await pool.connect();
  try {
    const st = await client.query(`SELECT id, name, status, started_at FROM inventory_sessions WHERE id=$1`, [sessionId]);
    if (st.rowCount === 0) return res.status(404).json({ ok: false, error: 'session_not_found' });

    const agg = await client.query(
      `WITH summed AS (
         SELECT product_id, SUM(qty)::numeric AS counted
         FROM inventory_counts
         WHERE session_id=$1
         GROUP BY product_id
       )
       SELECT p.id AS product_id, p.nom, p.code_barre, p.prix,
              s.stock_start,
              COALESCE(sm.counted, 0) AS counted_total
       FROM inventory_snapshot s
       JOIN produits p ON p.id = s.product_id
       LEFT JOIN summed sm ON sm.product_id = s.product_id
       WHERE s.session_id=$1
       ORDER BY p.id`,
      [sessionId]
    );

    let countedLines = 0, zeroLines = 0, deltaPlus = 0, deltaMinus = 0, deltaValue = 0;
    for (const r of agg.rows) {
      const delta = Number(r.counted_total) - Number(r.stock_start);
      if (r.counted_total !== 0) countedLines++; else zeroLines++;
      if (delta > 0) deltaPlus += delta;
      if (delta < 0) deltaMinus += Math.abs(delta);
      deltaValue += delta * Number(r.prix || 0);
    }

    res.json({
      ok: true,
      session: st.rows[0],
      lines: agg.rows,
      kpis: {
        countedLines,
        zeroLines,
        deltaPlus,
        deltaMinus,
        deltaNet: deltaPlus - deltaMinus,
        deltaValue
      }
    });
  } catch (e) {
    console.error('GET /inventory/:id/summary', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post('/inventory/:id/finalize', async (req, res) => {
  const sessionId = Number(req.params.id);
  const { user, email_to } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const st = await client.query(
      `SELECT id, status, name, started_at FROM inventory_sessions WHERE id=$1 FOR UPDATE`,
      [sessionId]
    );
    if (st.rowCount === 0) {
      await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'session_not_found' });
    }
    if (st.rows[0].status !== 'open') {
      await client.query('ROLLBACK'); return res.status(409).json({ ok: false, error: 'session_locked' });
    }

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

    let linesInserted = 0;
    let countedProducts = 0;
    let inventoryValue  = 0;

    for (const r of agg.rows) {
      const pid     = Number(r.product_id);
      const start   = Number(r.stock_start);
      const counted = Number(r.counted_total);
      const delta   = counted - start;
      const prix    = Number(r.prix || 0);

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
      session: {
        id: sess.id,
        name: sess.name,
        started_at: sess.started_at,
        ended_at: sess.ended_at
      },
      stats: {
        linesInserted,
        countedProducts,
        inventoryValue
      }
    };

    if (mailer && (email_to || process.env.INVENTORY_MAIL_TO)) {
      try {
        const to = email_to || process.env.INVENTORY_MAIL_TO;
        const d  = new Date(sess.ended_at);
        const dateStr = d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
        await mailer.sendMail({
          from: process.env.INVENTORY_MAIL_FROM || 'no-reply@coopaz',
          to,
          subject: `Inventaire clôturé — ${sess.name}`,
          text:
`Inventaire "${sess.name}" clôturé le ${dateStr}.

Produits inventoriés : ${countedProducts}
Valeur du stock inventorié : ${inventoryValue.toFixed(2)} €.

Session #${sessionId}`
        });
      } catch (err) {
        console.warn('Email inventaire non envoyé:', err?.message);
      }
    }

    res.json({ ok: true, recap });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /inventory/:id/finalize', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/* ────────────────────────────── SYNC ───────────────────────────── */

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

  // Appliquer un ordre logique
  const order = { 'adherent.created': 1, 'adherent.updated': 2, 'sale.created': 10, 'sale.updated': 11 };
  ops.sort((a, b) => (order[a.op_type] || 100) - (order[b.op_type] || 100));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const op of ops) {
      await client.query(
        `INSERT INTO ops (id, device_id, op_type, entity_type, entity_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, deviceId, op.op_type, op.entity_type || null, String(op.entity_id || ''), op.payload_json]
      );

      const r = await client.query(`SELECT applied_at, payload FROM ops WHERE id = $1`, [op.id]);
      if (r.rows[0]?.applied_at) continue;

      // Payload peut être JSON ou string
      let p = r.rows[0]?.payload ?? {};
      if (typeof p === 'string') {
        try { p = JSON.parse(p); } catch { p = {}; }
      }

      switch (op.op_type) {

      case 'sale.created': {
  let mpId = (p.modePaiementId ?? null);
  if (mpId != null) {
    const chk = await client.query(`SELECT 1 FROM modes_paiement WHERE id=$1`, [mpId]);
    if (chk.rowCount === 0) mpId = null;
  }

  let adherentId = (p.adherentId ?? null);
  if (adherentId != null) {
    const chk = await client.query('SELECT 1 FROM adherents WHERE id=$1', [adherentId]);
    if (chk.rowCount === 0) adherentId = null;
  }

  const baseValues = [
    Number(p.total ?? 0),
    adherentId,
    mpId,
    p.saleType || 'adherent',
    p.clientEmail || null
  ];

  if (p.venteId != null) {
    await client.query(
      `INSERT INTO ventes (id, total, adherent_id, mode_paiement_id, sale_type, client_email)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [Number(p.venteId), ...baseValues]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO ventes (total, adherent_id, mode_paiement_id, sale_type, client_email)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      baseValues
    );
    p.venteId = ins.rows[0].id;
  }

  try {
    if (p.fraisPaiement != null)
      await client.query(`UPDATE ventes SET frais_paiement = $2 WHERE id = $1`, [p.venteId, Number(p.fraisPaiement)]);
  } catch {}
  try {
    if (p.cotisation != null)
      await client.query(`UPDATE ventes SET cotisation = $2 WHERE id = $1`, [p.venteId, Number(p.cotisation)]);
  } catch {}
  break;
}


        case 'sale.line_added': {
          const sourceKey =
            (p.ligneId != null && p.ligneId !== '')
              ? `lv:${p.ligneId}`
              : `sale:${p.venteId}:${p.produitId}:${Number(p.quantite)}:${Number(p.prix)}`;

          const chk = await client.query(
            `SELECT id FROM lignes_vente
             WHERE vente_id=$1 AND produit_id=$2 AND quantite=$3 AND prix=$4
             LIMIT 1`,
            [p.venteId, p.produitId, p.quantite, p.prix]
          );

          if (chk.rowCount === 0) {
            await client.query(
              `INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [p.venteId, p.produitId, p.quantite, p.prix, p.prixUnitaire || null, p.remisePercent || 0]
            );
          }

          await client.query(
            `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
             VALUES ($1,'sale_line',$2,$3)
             ON CONFLICT (source_type, source_id) DO NOTHING`,
            [p.produitId, sourceKey, -Number(p.quantite)]
          );
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

          if (p.prixUnitaire != null) {
            await client.query(
              `UPDATE produits SET prix = $1, updated_at = now() WHERE id = $2`,
              [p.prixUnitaire, pid]
            );
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
          }
          break;
        }

        default:
          // types d’op non pris en charge -> ignore
          break;
      }

      await client.query(`UPDATE ops SET applied_at = now() WHERE id=$1`, [op.id]);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /sync/push_ops error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

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

    // réalignement des séquences
    await client.query(`SELECT setval(pg_get_serial_sequence('unites','id'),       (SELECT COALESCE(MAX(id),0) FROM unites))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('familles','id'),     (SELECT COALESCE(MAX(id),0) FROM familles))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('categories','id'),   (SELECT COALESCE(MAX(id),0) FROM categories))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('adherents','id'),    (SELECT COALESCE(MAX(id),0) FROM adherents))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('fournisseurs','id'), (SELECT COALESCE(MAX(id),0) FROM fournisseurs))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('produits','id'),     (SELECT COALESCE(MAX(id),0) FROM produits))`);

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

/* ────────────────────────────── Backfill stock init ───────────────────────────── */

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

/* ────────────────────────────── Start server ───────────────────────────── */

const port = process.env.PORT || 3001;
app.listen(port, () => console.log('caisse-api listening on', port));
