// src/main/config.js (CommonJS)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/** Emplacement du fichier de config à la racine de l’app (packagée ou dev). */
function getConfigPath() {
  try {
    return path.join(app.getAppPath(), 'config.json');
  } catch {
    // Fallback au cas où app.getAppPath() n’est pas dispo (dev/edge cases)
    return path.join(process.cwd(), 'config.json');
  }
}

/** Lecture synchrone de la config (objet). Toujours renvoie un objet avec au moins { modules:{} }. */
function getConfig() {
  try {
    const p = getConfigPath();
    const raw = fs.readFileSync(p, 'utf8');
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' ? cfg : { modules: {} };
  } catch {
    return { modules: {} };
  }
}

/** Écriture complète de la config (remplace). */
function saveConfig(nextCfg) {
  try {
    const p = getConfigPath();
    fs.writeFileSync(p, JSON.stringify(nextCfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[config] save failed:', e?.message || e);
    return false;
  }
}

/** Merge pratique : applique un patch par-dessus la config actuelle et sauvegarde. */
function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  saveConfig(next);
  return next;
}

/** Extrait tenant_id du JWT si présent. */
function parseJwtTenant(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload?.tenant_id || null;
  } catch {
    return null;
  }
}

/**
 * ensureAuth()
 * - si config.auth_token existe : on l’utilise
 * - sinon, si config.api_email + config.api_password : login → sauvegarde token dans config.json
 * - sinon : pas de token
 * Renvoie { ok, token?, tenant_id?, error? }
 */
async function ensureAuth() {
  const cfg = getConfig();
  const base = (cfg.api_base_url || '').replace(/\/+$/, '');

  // 1) Token déjà enregistré
  if (cfg.auth_token && typeof cfg.auth_token === 'string' && cfg.auth_token.trim() !== '') {
    return { ok: true, token: cfg.auth_token, tenant_id: parseJwtTenant(cfg.auth_token) };
  }

  // 2) Tentative de login si email/password fournis
  if (base && cfg.api_email && cfg.api_password) {
    try {
      const r = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cfg.api_email, password: cfg.api_password }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return { ok: false, error: `login http ${r.status}: ${t || 'fail'}` };
      }
      const js = await r.json();
      if (!js?.token) return { ok: false, error: 'login: token manquant' };

      const token = js.token;
      setConfig({ auth_token: token }); // persiste le token

      return { ok: true, token, tenant_id: parseJwtTenant(token) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // 3) Rien de dispo
  return { ok: false, error: 'Missing token' };
}

module.exports = {
  getConfigPath,
  getConfig,
  saveConfig,
  setConfig,     // <-- utilisé pour mettre à jour/effacer auth_token (logout)
  ensureAuth,
};
