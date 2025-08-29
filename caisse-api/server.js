// server.js
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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/health/db', async (_req, res) => {
  try {
    const r = await pool.query('select current_database() as db, current_user as usr');
    res.json({ ok: true, db: r.rows[0].db, usr: r.rows[0].usr });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// NEW: renseigne si bootstrap est nécessaire (ex: si produits est vide)
app.get('/sync/bootstrap_needed', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM produits`);
    res.json({ ok: true, needed: (r.rows[0].n === 0) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, needed: true });
  }
});

// PULL complet (réfs + produits/prix/stock + modes_paiement)
app.get('/sync/pull_refs', async (_req, res) => {
  const client = await pool.connect();
  try {
    const [
      unites, familles, categories, adherents, fournisseurs, produits, modes_paiement
    ] = await Promise.all([
      client.query(`SELECT id, nom FROM unites ORDER BY id`),
      client.query(`SELECT id, nom FROM familles ORDER BY id`),
      client.query(`SELECT id, nom FROM categories ORDER BY id`),
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

/**
 * PUSH des opérations (event-driven)
 * Gère : sale.created, sale.line_added, reception.line_added, inventory.adjust, stock.set, product.updated
 */
app.post('/sync/push_ops', async (req, res) => {
  const { deviceId, ops } = req.body || {};
  if (!deviceId || !Array.isArray(ops)) {
    return res.status(400).json({ ok: false, error: 'Bad payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const op of ops) {
      // insérer l’op si absente
      await client.query(
        `INSERT INTO ops (id, device_id, op_type, entity_type, entity_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, deviceId, op.op_type, op.entity_type || null, String(op.entity_id || ''), op.payload_json]
      );

      const r = await client.query(`SELECT applied_at, payload FROM ops WHERE id = $1`, [op.id]);
      if (r.rows[0]?.applied_at) continue;
      const p = r.rows[0]?.payload || {};

      // Route les types d’opérations
      switch (op.op_type) {
    case 'sale.created': {
  // ensure FK exists, otherwise set to NULL
  let mpId = (p.modePaiementId ?? null);
  if (mpId != null) {
    const chk = await client.query(`SELECT 1 FROM modes_paiement WHERE id=$1`, [mpId]);
    if (chk.rowCount === 0) {
      console.warn('[push_ops] sale.created: mode_paiement_id', mpId, 'absent sur Neon -> NULL');
      mpId = null;
    }
  }

  await client.query(
    `INSERT INTO ventes (id, total, adherent_id, mode_paiement_id, sale_type, client_email)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING`,
    [p.venteId || null, p.total || null, p.adherentId || null, mpId, p.saleType || 'adherent', p.clientEmail || null]
  );

  // Optionnel : frais & cotisation si colonnes présentes
  try {
    if (p.fraisPaiement != null) {
      await client.query(`UPDATE ventes SET frais_paiement = $2 WHERE id = $1`, [p.venteId, p.fraisPaiement]);
    }
  } catch {}
  try {
    if (p.cotisation != null) {
      await client.query(`UPDATE ventes SET cotisation = $2 WHERE id = $1`, [p.venteId, p.cotisation]);
    }
  } catch {}
  break;
}


        case 'sale.line_added': {
          // Fingerprint stable pour idempotence des mouvements
          const sourceKey =
            (p.ligneId != null && p.ligneId !== '')
              ? `lv:${p.ligneId}`
              : `sale:${p.venteId}:${p.produitId}:${Number(p.quantite)}:${Number(p.prix)}`;

          // Éviter un doublon exact de ligne (même vente, produit, qté, prix)
          const chk = await client.query(
            `SELECT id FROM lignes_vente
             WHERE vente_id=$1 AND produit_id=$2 AND quantite=$3 AND prix=$4
             LIMIT 1`,
            [p.venteId, p.produitId, p.quantite, p.prix]
          );

          if (chk.rowCount === 0) {
            // Insérer la ligne sans 'id' (laisse Postgres auto-incrémenter)
            await client.query(
              `INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [p.venteId, p.produitId, p.quantite, p.prix, p.prixUnitaire || null, p.remisePercent || 0]
            );
          }

          // Mouvement de stock idempotent via (source_type, source_id)
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

  // header réception si nécessaire (inchangé)
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

  // 🔧 LIGNE RÉCEPTION : brancher selon présence d'un id côté client
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

  // stock actuel agrégé (inchangé)
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
    await client.query(`UPDATE produits SET prix = $1, updated_at = now() WHERE id = $2`,
      [p.prixUnitaire, pid]);
  }
  break;
}

        case 'inventory.adjust': {
          // Ajustement d’inventaire (delta)
          await client.query(
            `INSERT INTO stock_movements (product_id, source_type, source_id, qty_change)
             VALUES ($1,'inventory_adjust',$2,$3)
             ON CONFLICT (source_type, source_id) DO NOTHING`,
            [p.produitId, String(op.id), Number(p.delta || 0)]
          );
          break;
        }

        case 'stock.set': {
          // Fixer le stock à une valeur absolue (datée côté device)
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
          // Met à jour les champs fournis (ex: prix, nom, reference)
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
          // ignorer types inconnus
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

// Bootstrap (push TOUT local → Neon)
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
      `INSERT INTO categories (id, nom, famille_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, famille_id = EXCLUDED.famille_id`,
      [c.id, c.nom, c.famille_id || null]
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

    // réaligner les séquences (utile si ids explicites)
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

/**
 * Backfill (à lancer une fois si des produits ont un stock mais aucun mouvement historique)
 * Crée un mouvement 'bootstrap:<id>' pour amener l'agrégat au stock actuel du produit.
 */
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
