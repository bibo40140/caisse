// caisse-api/routes/fournisseurs.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/** POST /fournisseurs  body: { nom, categorie_id?, contact?, email? } */
router.post('/fournisseurs', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const { nom, categorie_id = null, contact = null, email = null } = req.body || {};
  if (!tenantId || !nom) return res.status(400).json({ error: 'champs requis' });

  try {
    const q = await pool.query(
      `INSERT INTO fournisseurs (tenant_id, nom, categorie_id, contact, email)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, nom, categorie_id, contact, email`,
      [tenantId, nom, categorie_id, contact, email]
    );
    return res.json(q.rows[0]);
  } catch (e) {
    console.error('[POST /fournisseurs] error:', e);
    return res.status(500).json({ error: 'create fournisseur failed' });
  }
});

export default router;
