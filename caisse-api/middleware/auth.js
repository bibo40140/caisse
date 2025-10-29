// caisse-api/middleware/auth.js
import jwt from 'jsonwebtoken';

export function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload attendu: { user_id, tenant_id, role, iat, exp }
    req.user = { id: payload.user_id, role: payload.role };
    req.tenantId = payload.tenant_id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
