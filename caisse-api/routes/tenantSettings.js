// routes/tenantSettings.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { authRequired, tenantRequired, adminOrSuperAdmin } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const router     = express.Router();

/**
 * GET /tenant_settings/onboarding_status
 * - Super admin : toujours onboarded=true (il n'a pas d'onboarding)
 * - Sinon : lit tenant_settings du tenant courant
 */
router.get('/onboarding_status', authRequired, async (req, res) => {
  if (req.isSuperAdmin) {
    return res.json({
      ok: true,
      status: { onboarded: true, modules: {}, smtp: {}, logo_url: null }
    });
  }

  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT onboarded, modules_json, smtp_json, logo_url
         FROM tenant_settings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = r.rows[0];
    return res.json({
      ok: true,
      status: {
        onboarded: !!row?.onboarded,
        modules:   row?.modules_json || {},
        smtp:      row?.smtp_json    || {},
        logo_url:  row?.logo_url     || null,
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /tenant_settings/onboarding
 * body: { new_password?, modules?, smtp?, logo_base64? }
 * - Auth requis
 * - Tenant requis (admin du tenant OU super admin qui passe x-tenant-id)
 */
router.post(
  '/onboarding',
  authRequired,
  tenantRequired,       // garantit req.tenantId (ou message clair si super admin sans x-tenant-id)
  adminOrSuperAdmin,    // évite qu'un simple user change les réglages
  async (req, res) => {
    const tenantId = req.tenantId;
    const userId   = req.user?.id || null;
    const { new_password, modules, smtp, logo_base64 } = req.body || {};

    // ── (Optionnel) validations rapides
    if (new_password && String(new_password).length < 6) {
      return res.status(400).json({ ok: false, error: 'Mot de passe trop court (min 6 caractères).' });
    }

    // ── Upload logo (optionnel)
    let logoUrl = null;
    try {
      if (logo_base64 && /^data:image\/(png|jpeg|jpg);base64,/.test(logo_base64)) {
        // limite rudimentaire ~1.5 Mo
        const b64 = logo_base64.split(',')[1];
        const approxBytes = (b64.length * 3) / 4; // approx
        if (approxBytes > 1.5 * 1024 * 1024) {
          return res.status(400).json({ ok: false, error: 'Logo trop volumineux (max ~1.5 Mo).' });
        }

        const ext  = logo_base64.includes('jpeg') || logo_base64.includes('jpg') ? 'jpg' : 'png';
        const buf  = Buffer.from(b64, 'base64');
        const dir  = path.join(__dirname, '..', 'public', 'logos');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        const file = `${tenantId}.${ext}`;
        fs.writeFileSync(path.join(dir, file), buf);
        logoUrl = `/public/logos/${file}`;
      }
    } catch (e) {
      return res.status(400).json({ ok: false, error: `Logo invalide: ${e.message}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1) Mise à jour éventuelle du mot de passe de l'utilisateur courant (admin)
      if (new_password && userId) {
        const hash = await bcrypt.hash(String(new_password), 10);
        await client.query(
          `UPDATE users
              SET password_hash = $1
            WHERE id = $2 AND tenant_id = $3`,
          [hash, userId, tenantId]
        );
      }

      // 2) Mise à jour des réglages du tenant
      await client.query(
        `UPDATE tenant_settings
            SET modules_json = COALESCE($2, modules_json),
                smtp_json    = COALESCE($3, smtp_json),
                logo_url     = COALESCE($4, logo_url),
                onboarded    = true,
                updated_at   = now()
          WHERE tenant_id = $1`,
        [
          tenantId,
          modules ? JSON.stringify(modules) : null,
          smtp    ? JSON.stringify(smtp)    : null,
          logoUrl
        ]
      );

      await client.query('COMMIT');
      return res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: e.message });
    } finally {
      client.release();
    }
  }
);

export default router;
