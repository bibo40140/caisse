// caisse-api/routes/settings.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /tenants/settings/modules
 * body: { modules: { ... } }
 * Upsert JSONB "modules" dans tenant_settings pour le tenant courant.
 */
router.post('/tenants/settings/modules', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(400).json({ error: 'tenant_id manquant' });

  const modules = req.body?.modules || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // crée la ligne settings si absente
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, company_name, logo_url, modules)
       VALUES ($1, NULL, NULL, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE
         SET modules = EXCLUDED.modules`,
      [tenantId, JSON.stringify(modules)]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, modules });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /tenants/settings/modules] error:', e);
    return res.status(500).json({ error: 'settings update failed' });
  } finally {
    client.release();
  }
});

export default router;
