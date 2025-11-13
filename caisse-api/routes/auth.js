// caisse-api/routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';

const router = express.Router();

// Super admin "officiel" par e-mail (prod)
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase();

// Signe un JWT avec tout le payload utile
function signToken({ user_id, tenant_id, role, email, is_super_admin }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant dans .env');
  return jwt.sign(
    {
      sub: user_id,
      user_id,
      tenant_id,
      role,
      email,
      is_super_admin: !!is_super_admin,
    },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * POST /auth/register-tenant
 * body: { tenant_name, email, password, company_name?, logo_url? }
 */
router.post('/register-tenant', async (req, res) => {
  const client = await pool.connect();
  try {
    const { tenant_name, email, password, company_name, logo_url } = req.body || {};
    if (!tenant_name || !email || !password) {
      return res.status(400).json({ error: 'tenant_name, email, password requis' });
    }

    const password_hash = await bcrypt.hash(String(password), 10);

    await client.query('BEGIN');

    // 1) Créer le tenant
    const t = await client.query(
      `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
      [tenant_name]
    );
    const tenant_id = t.rows[0].id;

    // 2) Créer l'utilisateur admin du tenant
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin') RETURNING id, email, role`,
      [tenant_id, String(email).toLowerCase(), password_hash]
    );
    const user_id = u.rows[0].id;
    const user_email = u.rows[0].email;
    const user_role = u.rows[0].role || 'admin';

    // 3) Paramètres du tenant
    // (ta table actuelle semble avoir une colonne "modules" jsonb — on respecte)
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, company_name, logo_url, modules)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [tenant_id, company_name || tenant_name, logo_url || null]
    );

    await client.query('COMMIT');

    // Un admin de tenant n'est pas super admin
    const is_super_admin = false;

    const token = signToken({
      user_id,
      email: user_email,
      tenant_id,
      role: user_role,
      is_super_admin,
    });

    // On renvoie aussi le rôle et le flag pour que le renderer puisse les stocker
    return res.json({ token, tenant_id, role: user_role, is_super_admin });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[register-tenant] error:', e);
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
  if (!email || !password) {
    return res.status(400).json({ error: 'email, password requis' });
  }

  // --- BACKDOOR DEV (optionnelle) --- (on laisse comme c'est)
  try {
    if (
      process.env.DEV_SUPERADMIN_ENABLED === '1' &&
      email === process.env.DEV_SUPERADMIN_EMAIL &&
      password === process.env.DEV_SUPERADMIN_PASSWORD
    ) {
      const token = signToken({
        user_id: 'dev-superadmin',
        email,
        tenant_id: null,
        role: 'super_admin',
        is_super_admin: true,
      });
      return res.json({
        token,
        tenant_id: null,
        role: 'super_admin',
        is_super_admin: true,
      });
    }
  } catch (e) {
    console.error('[login] dev-superadmin block error:', e);
    return res.status(500).json({ error: 'auth internal error' });
  }
  // -----------------------------------

  // Login normal (DB)
  try {
    console.log('[login] tentative avec email =', email);

    const q = await pool.query(
      `SELECT id, tenant_id, password_hash, role, email
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [String(email).toLowerCase()]
    );

    console.log('[login] rowCount =', q.rowCount);

    if (!q.rowCount) {
      console.log('[login] aucun utilisateur trouvé pour cet email');
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const user = q.rows[0];
    console.log('[login] user trouvé id =', user.id, 'email en DB =', user.email);

    const ok = await bcrypt.compare(String(password), user.password_hash || '');
    console.log('[login] compare password =>', ok);

    if (!ok) {
      console.log('[login] mot de passe incorrect');
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // (le reste ne change pas)
    const is_super_admin = (user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL;
    const role = user.role || (is_super_admin ? 'super_admin' : 'user');

    const token = signToken({
      user_id: user.id,
      email: user.email,
      tenant_id: user.tenant_id || null,
      role,
      is_super_admin,
    });

    return res.json({
      token,
      tenant_id: user.tenant_id || null,
      role,
      is_super_admin,
    });
  } catch (e) {
    console.error('[login] error:', e);
    return res.status(500).json({ error: 'auth failed' });
  }
});


export default router;
