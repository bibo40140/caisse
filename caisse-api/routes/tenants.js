// routes/tenants.js
import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { seedTenantDefaults } from '../seed/seedTenantDefaults.js';

const router = express.Router();

/**
 * Route DEV : crée un tenant + user admin + tenant_settings
 * et lance le seed par défaut (familles, catégories, unités, modes de paiement).
 *
 * POST /tenants/dev-bootstrap
 * body: {
 *   tenantName: "Ma Coop",
 *   adminEmail: "fabien.hicauber@gmail.com",
 *   adminPassword: "monmdp"
 * }
 */
router.post('/dev-bootstrap', async (req, res) => {
  // Sécurité minimale : uniquement si DEV_SUPERADMIN_ENABLED=1
  if (process.env.DEV_SUPERADMIN_ENABLED !== '1') {
    return res.status(403).json({ ok: false, error: 'DEV_SUPERADMIN_DISABLED' });
  }

  const { tenantName, adminEmail, adminPassword } = req.body || {};

  if (!tenantName || !adminEmail || !adminPassword) {
    return res.status(400).json({ ok: false, error: 'tenantName_adminEmail_adminPassword_required' });
  }

  const emailNorm = String(adminEmail).trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Créer le tenant
    const t = await client.query(
      `INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, created_at`,
      [tenantName]
    );
    const tenantId = t.rows[0].id;

    // 2) Créer tenant_settings minimal
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, modules, modules_json, smtp_json, onboarded)
       VALUES ($1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, false)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    );

    // 3) Créer user admin
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, email, role, created_at`,
      [tenantId, emailNorm, passwordHash]
    );

    // 4) Seed par défaut pour ce tenant
    await seedTenantDefaults(client, tenantId, { withPayments: true });

    await client.query('COMMIT');

    res.json({
      ok: true,
      tenant: t.rows[0],
      admin: u.rows[0],
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('POST /tenants/dev-bootstrap error', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// (Optionnel) petit GET pour debug : liste des tenants
router.get('/', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, created_at FROM tenants ORDER BY created_at DESC`
    );
    res.json({ ok: true, tenants: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
