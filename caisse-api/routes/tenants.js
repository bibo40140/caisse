// caisse-api/routes/tenants.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired, superAdminOnly } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /tenants
 * Liste des tenants pour le super admin :
 * - id, name
 * - company_name (tenant_settings)
 * - admin_email (premier user role='admin' du tenant)
 */
router.get('/tenants', authRequired, superAdminOnly, async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        t.id,
        t.name,
        ts.company_name,
        u.admin_email
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT email AS admin_email
        FROM users
        WHERE tenant_id = t.id AND role = 'admin'
        ORDER BY id ASC
        LIMIT 1
      ) u ON TRUE
      ORDER BY t.name COLLATE "C";
    `);

    return res.json({ tenants: q.rows || [] });
  } catch (e) {
    console.error('[GET /tenants] error:', e);
    return res.status(500).json({ error: 'tenants list failed' });
  }
});

export default router;
