// routes/tenantSettings.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// ⬇️ remplace bcrypt natif par bcryptjs
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// GET /tenant_settings/onboarding_status
router.get('/onboarding_status', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const r = await pool.query(
      `SELECT onboarded, modules_json, smtp_json, logo_url
       FROM tenant_settings
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = r.rows[0];
    const onboarded = !!row?.onboarded;
    res.json({
      ok: true,
      status: {
        onboarded,
        modules: row?.modules_json || {},
        smtp: row?.smtp_json || {},
        logo_url: row?.logo_url || null
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /tenant_settings/onboarding
// body: { new_password?, modules?, smtp?, logo_base64? }
router.post('/onboarding', authRequired, async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.userId;
  const { new_password, modules, smtp, logo_base64 } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Mot de passe admin (facultatif)
    if (new_password && String(new_password).length >= 6) {
      const hash = await bcrypt.hash(String(new_password), 10);
      await client.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3`,
        [hash, userId, tenantId]
      );
    }

    // 2) Sauvegarde du logo si fourni
    let logoUrl = null;
    if (logo_base64 && /^data:image\/(png|jpeg|jpg);base64,/.test(logo_base64)) {
      const ext = logo_base64.includes('jpeg') || logo_base64.includes('jpg') ? 'jpg' : 'png';
      const b64 = logo_base64.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      const logosDir = path.join(__dirname, '..', 'public', 'logos');
      try { fs.mkdirSync(logosDir, { recursive: true }); } catch {}
      const fileName = `${tenantId}.${ext}`;
      const dest = path.join(logosDir, fileName);
      fs.writeFileSync(dest, buf);
      logoUrl = `/public/logos/${fileName}`;
    }

    // 3) Modules & SMTP → tenant_settings
    await client.query(
      `UPDATE tenant_settings
         SET modules_json = COALESCE($2, modules_json),
             smtp_json = COALESCE($3, smtp_json),
             logo_url = COALESCE($4, logo_url),
             onboarded = true,
             updated_at = now()
       WHERE tenant_id = $1`,
      [tenantId, modules ? JSON.stringify(modules) : null,
                smtp ? JSON.stringify(smtp) : null,
                logoUrl]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

export default router;
