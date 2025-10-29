// caisse-api/routes/tenantSettings.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
router.use(authRequired);

/** GET /tenant_settings */
router.get('/', async (req, res) => {
  const r = await pool.query(
    `SELECT tenant_id, company_name, logo_url, smtp_host, smtp_port, smtp_user, smtp_secure,
            from_email, from_name, modules, updated_at
     FROM tenant_settings
     WHERE tenant_id = $1`,
    [req.tenantId]
  );
  return res.json(r.rows[0] || null);
});

/** PUT /tenant_settings */
router.put('/', async (req, res) => {
  const {
    company_name, logo_url, smtp_host, smtp_port, smtp_user, smtp_pass,
    smtp_secure, from_email, from_name, modules
  } = req.body || {};

  const r = await pool.query(
    `UPDATE tenant_settings
     SET company_name = COALESCE($2, company_name),
         logo_url     = COALESCE($3, logo_url),
         smtp_host    = COALESCE($4, smtp_host),
         smtp_port    = COALESCE($5, smtp_port),
         smtp_user    = COALESCE($6, smtp_user),
         smtp_pass    = COALESCE($7, smtp_pass),
         smtp_secure  = COALESCE($8, smtp_secure),
         from_email   = COALESCE($9, from_email),
         from_name    = COALESCE($10, from_name),
         modules      = COALESCE($11::jsonb, modules),
         updated_at   = now()
     WHERE tenant_id = $1
     RETURNING *`,
    [req.tenantId, company_name, logo_url, smtp_host, smtp_port, smtp_user,
     smtp_pass, smtp_secure, from_email, from_name, modules ?? null]
  );
  return res.json(r.rows[0]);
});

export default router;
