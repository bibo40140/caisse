// caisse-api/routes/fournisseurs.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/** PATCH /fournisseurs/:id  body: { nom?, categorie_id?, referent_id?, label?, contact?, email?, telephone?, adresse?, code_postal?, ville? } */
router.patch('/fournisseurs/:id', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const fournisseurId = req.params.id;
  if (!tenantId || !fournisseurId) return res.status(400).json({ error: 'champs requis' });

  // Champs modifiables
  const {
    nom,
    categorie_id,
    referent_id,
    label,
    contact,
    email,
    telephone,
    adresse,
    code_postal,
    ville
  } = req.body || {};

  // Construction dynamique de la requête
  const fields = [];
  const values = [tenantId, fournisseurId];
  if (nom !== undefined) { fields.push('nom'); values.push(nom); }
  if (categorie_id !== undefined) { fields.push('categorie_id'); values.push(categorie_id); }
  if (referent_id !== undefined) { fields.push('referent_id'); values.push(referent_id); }
  if (label !== undefined) { fields.push('label'); values.push(label); }
  if (contact !== undefined) { fields.push('contact'); values.push(contact); }
  if (email !== undefined) { fields.push('email'); values.push(email); }
  if (telephone !== undefined) { fields.push('telephone'); values.push(telephone); }
  if (adresse !== undefined) { fields.push('adresse'); values.push(adresse); }
  if (code_postal !== undefined) { fields.push('code_postal'); values.push(code_postal); }
  if (ville !== undefined) { fields.push('ville'); values.push(ville); }

  if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  // Génère la requête SQL
  const setClause = fields.map((f, i) => `${f} = $${i+3}`).join(', ');
  const sql = `UPDATE fournisseurs SET ${setClause}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`;

  try {
    const q = await pool.query(sql, values);
    if (q.rowCount === 0) return res.status(404).json({ error: 'Fournisseur non trouvé' });
    return res.json(q.rows[0]);
  } catch (e) {
    console.error('[PATCH /fournisseurs/:id] error:', e);
    return res.status(500).json({ error: 'update fournisseur failed' });
  }
});

/** POST /fournisseurs  body: { nom, categorie_id?, contact?, email? } */
router.post('/fournisseurs', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const {
    nom,
    categorie_id = null,
    referent_id = null,
    contact = null,
    email = null
  } = req.body || {};
  if (!tenantId || !nom) return res.status(400).json({ error: 'champs requis' });

  try {
    const q = await pool.query(
      `INSERT INTO fournisseurs (tenant_id, nom, categorie_id, referent_id, contact, email)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nom, categorie_id, referent_id, contact, email`,
      [tenantId, nom, categorie_id, referent_id, contact, email]
    );
    return res.json(q.rows[0]);
  } catch (e) {
    console.error('[POST /fournisseurs] error:', e);
    return res.status(500).json({ error: 'create fournisseur failed' });
  }
});

export default router;
