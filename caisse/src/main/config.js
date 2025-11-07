// src/main/config.js (CommonJS) — version robuste avec login silencieux
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { apiFetch, setApiBase, setAuthToken, getAuthToken } = require('./apiClient');
const { ensureAuth, getConfig, setConfig } = require('./src/main/config');


/** Emplacement du fichier de config à la racine de l’app (packagée ou dev). */
function getConfigPath() {
  try {
    return path.join(app.getAppPath(), 'config.json');
  } catch {
    // Fallback dev
    return path.join(process.cwd(), 'config.json');
  }
}

/** Lecture synchrone de la config (objet). Toujours renvoie un objet avec au moins { modules:{} }. */
function getConfig() {
  try {
    const p = getConfigPath();
    const raw = fs.readFileSync(p, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && cfg.api_base_url) {
      cfg.api_base_url = String(cfg.api_base_url).replace(/\/+$/, '');
    }
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

/** Utilitaire JSON sûr pour apiFetch */
async function safeJson(r) {
  const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
  if (!ct.includes('application/json')) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} non-JSON: ${text.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * ensureAuth()
 * - positionne l'API base depuis config.json (ou env CAISSE_API_URL)
 * - si config.auth_token existe → on l’utilise et on le met dans l’apiClient/env
 * - sinon, si process.env.API_AUTH_TOKEN → on l’utilise et on le persiste dans config.json
 * - sinon, si config.api_email + config.api_password → login silencieux, puis persistance token
 * - sinon → { ok:false, error:'Missing token' } (laisser la fenêtre de login s’ouvrir côté app)
 * Renvoie { ok, token?, tenant_id?, error? }
 */
async function ensureAuth() {
  const cfg = getConfig();

  // 0) positionner la base API pour tous les appels suivants
  const base = (cfg.api_base_url || process.env.CAISSE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
  setApiBase(base);

  // 1) Token déjà enregistré en config.json
  if (cfg.auth_token && typeof cfg.auth_token === 'string' && cfg.auth_token.trim() !== '') {
    const token = cfg.auth_token.trim();
    setAuthToken(token);
    process.env.API_AUTH_TOKEN = token; // compat modules
    return { ok: true, token, tenant_id: parseJwtTenant(token) };
  }

  // 2) Token via env → seulement si autorisé
if (cfg.allow_auto_login === true) {
  if (process.env.API_AUTH_TOKEN && String(process.env.API_AUTH_TOKEN).trim()) {
    const token = String(process.env.API_AUTH_TOKEN).trim();
    setAuthToken(token);
    setConfig({ auth_token: token });
    return { ok: true, token, tenant_id: parseJwtTenant(token) };
  }

  // 3) Token déjà en mémoire (apiClient) ?
  const mem = getAuthToken && getAuthToken();
  if (mem) {
    setAuthToken(mem);
    setConfig({ auth_token: mem });
    return { ok: true, token: mem, tenant_id: parseJwtTenant(mem) };
  }

  // 4) Tentative de login silencieux via config.json (email+password)
  if (base && cfg.api_email && cfg.api_password) {
    try {
      const r = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: cfg.api_email, password: cfg.api_password }),
      });
      const js = await safeJson(r);
      if (!r.ok || !js?.token) {
        return { ok: false, error: js?.error || `login http ${r.status}` };
      }
      const token = js.token;
      setAuthToken(token);
      setConfig({ auth_token: token });
      return { ok: true, token, tenant_id: parseJwtTenant(token) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}

  // 5) Rien de dispo → le renderer devra ouvrir la fenêtre de login
  return { ok: false, error: 'Missing token' };
}


function clearAuth() {
  setAuthToken('');
  const cfg = getConfig();
  delete cfg.auth_token;
  delete cfg.api_email;
  delete cfg.api_password;
  saveConfig(cfg);
}
module.exports = {
  getConfigPath,
  getConfig,
  saveConfig,
  setConfig,
  ensureAuth,
  clearAuth 
};
