// caisse-api/routes/produits.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/** POST /produits body: { nom, categorie_id?, fournisseur_id?, unite_id?, code_barre?, prix, stock } */
router.post('/produits', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const {
    nom, categorie_id = null, fournisseur_id = null, unite_id = null,
    code_barre = null, prix = 0, stock = 0
  } = req.body || {};
  if (!tenantId || !nom) return res.status(400).json({ error: 'champs requis' });

  try {
    const q = await pool.query(
      `INSERT INTO produits (tenant_id, nom, categorie_id, fournisseur_id, unite_id, code_barre, prix, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, nom, prix, stock`,
      [tenantId, nom, categorie_id, fournisseur_id, unite_id, code_barre, Number(prix), Number(stock)]
    );
    return res.json(q.rows[0]);
  } catch (e) {
    console.error('[POST /produits] error:', e);
    return res.status(500).json({ error: 'create produit failed' });
  }
});

export default router;
