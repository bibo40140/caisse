'use strict';
const fetch = require('node-fetch');

let API_BASE = (process.env.CAISSE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
let AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';

// --- UUID helper ---
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read tenant id safely
function getTenantIdSafe() {
  try {
    const authState = require('./auth/state'); // may or may not exist in your tree
    if (authState && typeof authState.getTenantId === 'function') {
      const t = authState.getTenantId();
      return (typeof t === 'string' && UUID_RE.test(t)) ? t : null;
    }
    if (authState && typeof authState.tenantId === 'string') {
      return UUID_RE.test(authState.tenantId) ? authState.tenantId : null;
    }
  } catch (_) {}
  const envT = process.env.TENANT_ID;
  return (typeof envT === 'string' && UUID_RE.test(envT)) ? envT : null;
}

function setApiBase(url) {
  if (!url) return;
  API_BASE = String(url).replace(/\/+$/, '');
}
function getApiBase() { return API_BASE; }

function setAuthToken(token) {
  AUTH_TOKEN = token || '';
  if (AUTH_TOKEN) process.env.API_AUTH_TOKEN = AUTH_TOKEN; // compat for older modules
}
function getAuthToken() { return AUTH_TOKEN || process.env.API_AUTH_TOKEN || ''; }
function getAuthHeader() { const t = getAuthToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

function buildJsonHeaders(extra = {}) {
  const headers = { accept: 'application/json', 'content-type': 'application/json', ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = getTenantIdSafe();
  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  } else if ('x-tenant-id' in headers) {
    delete headers['x-tenant-id'];
  }
  return headers;
}

async function apiFetch(path, init = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const headers = buildJsonHeaders(init.headers || {});
  return fetch(url, { ...init, headers });
}

function logout() { AUTH_TOKEN = null; }

module.exports = {
  setApiBase,
  getApiBase,
  setAuthToken,
  getAuthToken,
  getAuthHeader,     // keep for compat
  buildJsonHeaders,
  apiFetch,
  logout
};
