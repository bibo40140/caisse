// caisse-api/routes/adherents.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired, tenantRequired } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /adherents
 * Body accepté: { nom, prenom?, email1?, email2?, telephone1?, telephone2?, ville?, code_postal?, adresse?, statut? }
 * - statut: "actif" => archive=false ; "archive" => archive=true (par défaut: actif)
 */
router.post('/', authRequired, tenantRequired, async (req, res) => {
  const tenant_id = req.tenantId; // UUID
  try {
    const {
      nom,
      prenom = null,
      email1 = null,
      email2 = null,
      telephone1 = null,
      telephone2 = null,
      ville = null,
      code_postal = null,
      adresse = null,
      statut = 'actif',
    } = req.body || {};

    if (!nom) return res.status(400).json({ error: 'nom requis' });

    // map "statut" -> archive (bool)
    const archive =
      String(statut || '').toLowerCase() === 'archive' ||
      String(statut || '').toLowerCase() === 'archivé';

    // On insère UNIQUEMENT des colonnes qui existent dans ta table
    const q = await pool.query(
      `
      INSERT INTO adherents
        (tenant_id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville, archive)
      VALUES
        ($1,        $2,  $3,    $4,     $5,     $6,         $7,         $8,      $9,          $10,  $11)
      RETURNING id
      `,
      [tenant_id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville, archive]
    );

    return res.json({
      id: q.rows[0].id,
      nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
      statut: archive ? 'archive' : 'actif',
    });
  } catch (e) {
    console.error('[POST /adherents] error:', e);
    return res.status(500).json({ error: 'create adherent failed' });
  }
});

export default router;
