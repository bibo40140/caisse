// caisse-api/routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';

const router = express.Router();

function signToken({ user_id, tenant_id, role }) {
  return jwt.sign(
    { user_id, tenant_id, role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * POST /auth/register-tenant
 * body: { tenant_name, email, password, company_name, logo_url }
 */
router.post('/register-tenant', async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_name, email, password, company_name, logo_url } = req.body || {};
    if (!tenant_name || !email || !password) {
      return res.status(400).json({ error: 'tenant_name, email, password requis' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const t = await client.query(
      `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
      [tenant_name]
    );
    const tenant_id = t.rows[0].id;

    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin') RETURNING id`,
      [tenant_id, email.toLowerCase(), password_hash]
    );
    const user_id = u.rows[0].id;

    await client.query(
      `INSERT INTO tenant_settings (tenant_id, company_name, logo_url, modules)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [tenant_id, company_name || tenant_name, logo_url || null]
    );

    await client.query('COMMIT');

    const token = signToken({ user_id, tenant_id, role: 'admin' });
    return res.json({ token, tenant_id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({ error: 'register-tenant failed' });
  } finally {
    client.release();
  }
});

/**
 * POST /auth/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email, password requis' });

  const q = await pool.query(
    `SELECT id, tenant_id, password_hash, role
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );
  if (!q.rowCount) return res.status(401).json({ error: 'Identifiants invalides' });

  const u = q.rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

  const token = signToken({ user_id: u.id, tenant_id: u.tenant_id, role: u.role });
  return res.json({ token, tenant_id: u.tenant_id });
});

export default router;
