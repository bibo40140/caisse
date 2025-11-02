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

/* ===========================================================
 * Helpers
 * =========================================================*/
async function ensureSettingsRow(tenantId) {
  // crée la ligne si elle n'existe pas
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id)
     VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

/* ===========================================================
 * GET /tenant_settings/onboarding_status
 * - Super admin : toujours onboarded=true (pas d'onboarding)
 * - Sinon : lit tenant_settings du tenant courant
 * =========================================================*/
router.get('/onboarding_status', authRequired, async (req, res) => {
  // Si super admin + x-tenant-id => on lit CE tenant (impersonation)
  const impersonatedTenant = (req.isSuperAdmin && req.headers['x-tenant-id'])
    ? String(req.headers['x-tenant-id'])
    : null;

  if (req.isSuperAdmin && !impersonatedTenant) {
    // Super admin SANS contexte => status générique
    return res.json({
      ok: true,
      status: { onboarded: true, modules: {}, smtp: {}, logo_url: null }
    });
  }

  const tenantId = impersonatedTenant || req.tenantId;
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

/* ===========================================================
 * POST /tenant_settings/onboarding
 * body: { new_password?, modules?, smtp?, logo_base64? }
 * - Auth requis
 * - Tenant requis (admin du tenant OU super admin qui passe x-tenant-id)
 * =========================================================*/
router.post(
  '/onboarding',
  authRequired,
  tenantRequired,
  adminOrSuperAdmin,
  async (req, res) => {
    const tenantId = req.tenantId;
    const userId   = req.user?.id || null;
    const { new_password, modules, smtp, logo_base64 } = req.body || {};

    // Validations rapides
    if (new_password && String(new_password).length < 6) {
      return res.status(400).json({ ok: false, error: 'Mot de passe trop court (min 6 caractères).' });
    }

    // Upload logo (optionnel)
    let logoUrl = null;
    try {
      if (logo_base64 && /^data:image\/(png|jpeg|jpg);base64,/.test(logo_base64)) {
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

      await ensureSettingsRow(tenantId);

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

      // 2) UPSERT des réglages du tenant
      await client.query(
        `INSERT INTO tenant_settings (tenant_id, modules_json, smtp_json, logo_url, onboarded, updated_at)
         VALUES ($1, COALESCE($2::jsonb, '{}'::jsonb), COALESCE($3::jsonb, '{}'::jsonb), $4, true, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           modules_json = COALESCE(EXCLUDED.modules_json, tenant_settings.modules_json),
           smtp_json    = COALESCE(EXCLUDED.smtp_json, tenant_settings.smtp_json),
           logo_url     = COALESCE(EXCLUDED.logo_url, tenant_settings.logo_url),
           onboarded    = true,
           updated_at   = now()`,
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

/* ===========================================================
 * MODULES — persistance par tenant
 * GET  /tenant_settings/modules       -> { ok, modules: {...} }
 * PUT  /tenant_settings/modules  (body = { ...flags bool... })
 *      -> { ok, modules: {...} }
 * =========================================================*/
router.get(
  '/modules',
  authRequired,
  tenantRequired,
  async (req, res) => {
    const tenantId = req.tenantId;
    try {
      await ensureSettingsRow(tenantId);
      const r = await pool.query(
        `SELECT modules_json FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      const modules = r.rows[0]?.modules_json || {};
      return res.json({ ok: true, modules });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

router.put(
  '/modules',
  authRequired,
  tenantRequired,
  adminOrSuperAdmin,
  async (req, res) => {
    const tenantId = req.tenantId;
    let modules = req.body || {};
    // sécurité : seulement des booléens simples attendus
    try {
      if (modules && typeof modules === 'object') {
        modules = Object.fromEntries(
          Object.entries(modules).map(([k, v]) => [k, !!v])
        );
      } else {
        modules = {};
      }

      await ensureSettingsRow(tenantId);
      const r = await pool.query(
        `UPDATE tenant_settings
           SET modules_json = $2::jsonb, updated_at = now()
         WHERE tenant_id = $1
         RETURNING modules_json`,
        [tenantId, JSON.stringify(modules)]
      );

      const saved = r.rows[0]?.modules_json || {};
      return res.json({ ok: true, modules: saved });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

/* ===========================================================
 * EMAIL (SMTP) — par tenant
 * GET  /tenant_settings/email  -> { ok, settings: {...} }
 * PUT  /tenant_settings/email  -> { ok, settings: {...} }
 * (ici on stocke en clair dans smtp_json ; si tu as un module
 *  crypto plus tard on pourra chiffrer le password)
 * =========================================================*/
router.get(
  '/email',
  authRequired,
  tenantRequired,
  async (req, res) => {
    const tenantId = req.tenantId;
    try {
      await ensureSettingsRow(tenantId);
      const r = await pool.query(
        `SELECT smtp_json FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      const settings = r.rows[0]?.smtp_json || {};
      return res.json({ ok: true, settings });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

router.put(
  '/email',
  authRequired,
  tenantRequired,
  adminOrSuperAdmin,
  async (req, res) => {
    const tenantId = req.tenantId;
    let settings = req.body || {};
    try {
      // Nettoyage : on supprime les undefined, on normalise quelques champs
      const cleaned = {};
      for (const [k, v] of Object.entries(settings)) {
        if (v === undefined) continue;
        cleaned[k] = v;
      }
      await ensureSettingsRow(tenantId);
      const r = await pool.query(
        `UPDATE tenant_settings
           SET smtp_json = $2::jsonb, updated_at = now()
         WHERE tenant_id = $1
         RETURNING smtp_json`,
        [tenantId, JSON.stringify(cleaned)]
      );
      const saved = r.rows[0]?.smtp_json || {};
      return res.json({ ok: true, settings: saved });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

export default router;
