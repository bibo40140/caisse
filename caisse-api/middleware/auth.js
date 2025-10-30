// caisse-api/middleware/auth.js
import jwt from 'jsonwebtoken';

/**
 * Récupère le token "Bearer xxx" depuis l'en-tête Authorization.
 */
function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * Vérifie et normalise le JWT.
 * Retourne toujours les mêmes clés pour le code appelant.
 */
function verifyTokenOrThrow(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // On explicite l'absence de secret (mieux pour le debug)
    const err = new Error('JWT_SECRET not configured');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }
  const p = jwt.verify(token, secret); // peut throw (TokenExpiredError, JsonWebTokenError, etc.)
  return {
    user_id:        p.user_id ?? p.sub ?? null,
    email:          p.email ?? null,
    tenant_id:      p.tenant_id ?? null, // peut rester null pour super admin global
    role:           p.role ?? 'user',
    is_super_admin: !!p.is_super_admin,
    raw:            p,
  };
}

/**
 * Applique les infos d'auth sur la requête, avec support de l'impersonation super admin.
 * - Remplit req.user, req.userId, req.tenantId, req.role, req.isSuperAdmin
 * - Si super admin et header "x-tenant-id" présent => override de tenant pour agir "au nom de".
 */
function assignAuthContext(req, payload) {
  req.userId       = payload.user_id;
  req.role         = payload.role;
  req.isSuperAdmin = payload.is_super_admin === true;

  let tenantId = payload.tenant_id ?? null;
  const overrideTenant = req.headers['x-tenant-id'];
  if (req.isSuperAdmin && overrideTenant) {
    tenantId = String(overrideTenant);
  }
  req.tenantId = tenantId;

  req.user = {
    id: payload.user_id,
    email: payload.email,
    role: payload.role,
  };
}

/**
 * Middleware: auth obligatoire.
 */
export function authRequired(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const payload = verifyTokenOrThrow(token);
    assignAuthContext(req, payload);
    return next();
  } catch (e) {
    if (e.code === 'JWT_SECRET_MISSING') {
      return res.status(500).json({ error: 'Server misconfiguration (JWT secret missing)' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware: auth optionnelle (n’échoue pas si pas/invalid token).
 * Remplit req.user/req.tenantId/req.isSuperAdmin si token OK.
 */
export function optionalAuth(req, _res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return next();

    const payload = verifyTokenOrThrow(token);
    assignAuthContext(req, payload);
    return next();
  } catch {
    // Token invalide → on ignore et on passe la main sans contexte
    return next();
  }
}

/**
 * Garde: besoin d’un tenant (pour routes multi-tenant).
 * Autorise super admin si un x-tenant-id a été fourni (impersonation),
 * sinon 400.
 */
export function tenantRequired(req, res, next) {
  if (req.tenantId) return next();
  if (req.isSuperAdmin) {
    return res.status(400).json({
      error: 'Tenant required. Super admin: pass x-tenant-id header to impersonate a tenant.',
    });
  }
  return res.status(400).json({ error: 'Tenant missing' });
}

/**
 * Garde: admin du tenant OU super admin.
 */
export function adminOrSuperAdmin(req, res, next) {
  if (req.isSuperAdmin) return next();
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin required' });
}

/**
 * Garde: super admin uniquement.
 */
export function superAdminOnly(req, res, next) {
  if (req.isSuperAdmin) return next();
  return res.status(403).json({ error: 'Super admin required' });
}
