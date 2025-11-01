// caisse-api/routes/receptions.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /receptions
 * body: { fournisseur_id?, lignes: [{ produit_id, quantite, prix_achat? }] }
 * Effets: crée réception + lignes, incrémente stock produits.
 */
router.post('/receptions', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const { fournisseur_id = null, lignes = [] } = req.body || {};
  if (!tenantId || !Array.isArray(lignes) || !lignes.length) {
    return res.status(400).json({ error: 'lignes requises' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO receptions (tenant_id, fournisseur_id)
       VALUES ($1,$2) RETURNING id`,
      [tenantId, fournisseur_id]
    );
    const receptionId = r.rows[0].id;

    for (const l of lignes) {
      const pid = Number(l.produit_id);
      const qty = Number(l.quantite || 0);
      const pa  = Number(l.prix_achat || 0);
      if (!Number.isFinite(pid) || qty <= 0) continue;

      await client.query(
        `INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_achat)
         VALUES ($1,$2,$3,$4)`,
        [receptionId, pid, qty, pa]
      );

      await client.query(
        `UPDATE produits SET stock = COALESCE(stock,0) + $1 WHERE tenant_id=$2 AND id=$3`,
        [qty, tenantId, pid]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true, reception_id: receptionId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /receptions] error:', e);
    return res.status(500).json({ error: 'create reception failed' });
  } finally {
    client.release();
  }
});

export default router;
