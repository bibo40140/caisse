// caisse-api/middleware/auth.js
import jwt from 'jsonwebtoken';

/** UUID validator (v1–v5) */
function isUUID(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** Récupère le token "Bearer xxx" depuis l'en-tête Authorization. */
function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Vérifie et normalise le JWT. */
function verifyTokenOrThrow(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
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
 * - Si super admin et header "x-tenant-id" **valide (UUID)** => override de tenant.
 * - Si le tenant du JWT n'est pas un UUID, on l'ignore (évite "invalid input syntax for type uuid").
 */
function assignAuthContext(req, payload) {
  req.userId       = payload.user_id;
  req.role         = payload.role;
  req.isSuperAdmin = payload.is_super_admin === true;

  // Point de départ: tenant du JWT uniquement s'il est bien formé
  let tenantId = isUUID(payload.tenant_id) ? String(payload.tenant_id) : null;

  // Impersonation autorisée uniquement si super admin + x-tenant-id est un UUID
  const overrideTenant = req.headers['x-tenant-id'];
  if (req.isSuperAdmin && isUUID(overrideTenant)) {
    tenantId = String(overrideTenant);
  }

  req.tenantId = tenantId;
  req.user = {
    id: payload.user_id,
    email: payload.email,
    role: payload.role,
    tenant_id: tenantId,
  };
}

/** Middleware: auth obligatoire. */
export function authRequired(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const payload = verifyTokenOrThrow(token);
    assignAuthContext(req, payload);

    // Si après tout ça, pas de tenant → on refuse (sauf routes publiques)
    if (!req.tenantId && !req.isSuperAdmin) {
      return res.status(400).json({ error: 'Tenant missing' });
    }
    return next();
  } catch (e) {
    if (e.code === 'JWT_SECRET_MISSING') {
      return res.status(500).json({ error: 'Server misconfiguration (JWT secret missing)' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Middleware: auth optionnelle. */
export function optionalAuth(req, _res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return next();

    const payload = verifyTokenOrThrow(token);
    assignAuthContext(req, payload);
    return next();
  } catch {
    return next();
  }
}

/** Garde: besoin d’un tenant (pour routes multi-tenant). */
export function tenantRequired(req, res, next) {
  if (req.tenantId) return next();
  if (req.isSuperAdmin) {
    return res.status(400).json({
      error: 'Tenant required. Super admin: pass x-tenant-id (UUID) to impersonate a tenant.',
    });
  }
  return res.status(400).json({ error: 'Tenant missing' });
}

/** Garde: admin du tenant OU super admin. */
export function adminOrSuperAdmin(req, res, next) {
  if (req.isSuperAdmin) return next();
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'tenant_admin') return next();
  return res.status(403).json({ error: 'Admin required' });
}

/** Garde: super admin uniquement. */
export function superAdminOnly(req, res, next) {
  if (req.isSuperAdmin) return next();
  return res.status(403).json({ error: 'Super admin required' });
}
