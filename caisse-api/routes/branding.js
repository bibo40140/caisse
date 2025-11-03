// caisse-api/routes/branding.js
import express from 'express';
import { pool as defaultPool } from '../db/index.js'; // au cas où on n’injecte pas

export default function makeBrandingRouter({ pool = defaultPool } = {}) {
  const router = express.Router();

  // Helper pour extraire tenant_id (vient de authRequired)
  function getTenantId(req) {
    // selon ton middleware auth, ça peut être req.tenantId, req.user?.tenant_id, etc.
    return req.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
  }

  // GET /branding
  router.get('/branding', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ ok:false, error:'tenant_required' });

    try {
      const r = await pool.query(
        `SELECT name, logo_mime, logo_data, updated_at
           FROM tenant_branding
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const row = r.rows[0];
      res.json({
        ok: true,
        name: row?.name || null,
        has_logo: !!row?.logo_data,
        updated_at: row?.updated_at || null,
      });
    } catch (e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // GET /branding/logo (sert le binaire)
  router.get('/branding/logo', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ ok:false, error:'tenant_required' });

    try {
      const r = await pool.query(
        `SELECT logo_mime, logo_data
           FROM tenant_branding
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const row = r.rows[0];
      if (!row || !row.logo_data) return res.status(404).send('No logo');
      res.setHeader('Content-Type', row.logo_mime || 'image/png');
      res.send(row.logo_data);
    } catch (e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // PUT /branding  body: { name?, logoDataUrl? }
  router.put('/branding', async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ ok:false, error:'tenant_required' });

    const { name, logoDataUrl } = req.body || {};
    let logoMime = null;
    let logoBuf = null;

    // Parse data URL si présent
    if (logoDataUrl && typeof logoDataUrl === 'string' && logoDataUrl.startsWith('data:')) {
      const m = logoDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ ok:false, error:'bad_data_url' });
      logoMime = m[1];
      try {
        logoBuf = Buffer.from(m[2], 'base64');
      } catch {
        return res.status(400).json({ ok:false, error:'bad_base64' });
      }
    }

    try {
      await pool.query('BEGIN');

      // upsert
      await pool.query(
        `
        INSERT INTO tenant_branding (tenant_id, name, logo_mime, logo_data, updated_at)
        VALUES ($1, COALESCE($2, NULL), $3, $4, now())
        ON CONFLICT (tenant_id) DO UPDATE
          SET name = COALESCE($2, tenant_branding.name),
              logo_mime = COALESCE($3, tenant_branding.logo_mime),
              logo_data = COALESCE($4, tenant_branding.logo_data),
              updated_at = now()
        `,
        [tenantId, name ?? null, logoMime, logoBuf]
      );

      const r = await pool.query(
        `SELECT name, logo_mime, (logo_data IS NOT NULL) AS has_logo, updated_at
           FROM tenant_branding
          WHERE tenant_id = $1`,
        [tenantId]
      );

      await pool.query('COMMIT');
      const row = r.rows[0];
      res.json({
        ok: true,
        name: row?.name || null,
        has_logo: !!row?.has_logo,
        updated_at: row?.updated_at || null,
      });
    } catch (e) {
      await pool.query('ROLLBACK');
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  return router;
}
