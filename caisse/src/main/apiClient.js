// src/main/apiClient.js
'use strict';

const fetch = require('node-fetch');

/**
 * Base API :
 * - On autorise CAISSE_API_URL via l'env pour pointer l'API (utile en dev),
 * - mais on NE LIT PLUS le token depuis l'env pour éviter l'auto-login.
 */
// Par défaut, pointer sur l'API Render sauf override local
let API_BASE = (process.env.CAISSE_API_URL || 'https://caisse-api-xxxx.onrender.com').replace(/\/+$/, '');
let AUTH_TOKEN = ''; // plus de fallback env ici (anti auto-login)

/**
 * Récupère le tenantId depuis la “source unique” d’auth.
 * On évite toute dépendance aux variables d’environnement.
 */
function getTenantId() {
  try {
    const authState = require('./auth/state');
    if (typeof authState.getTenantId === 'function') return authState.getTenantId() || null;
    return authState.tenantId || null;
  } catch (_) {
    return null;
  }
}

/* =========================
 * API base helpers
 * =======================*/
function setApiBase(url) {
  if (!url) return;
  API_BASE = String(url).replace(/\/+$/, '');
}
function getApiBase() {
  return API_BASE;
}

/* =========================
 * Auth helpers
 * =======================*/
function setAuthToken(token) {
  AUTH_TOKEN = token || '';
  // Correction : on met à jour le tenant_id dans auth/state.js à chaque fois
  try {
    require('./auth/state').set({ token });
  } catch (e) {
    console.warn('[apiClient] Erreur set tenant_id:', e?.message || e);
  }
  // ⚠️ On NE copie PAS dans process.env pour éviter toute “ré-auth” implicite
  // via des modules qui lisent l'env.
}
function getAuthToken() {
  // Ne lit plus process.env.API_AUTH_TOKEN → évite de skipper le login.
  return AUTH_TOKEN || '';
}

function getAuthHeader() {
  const headers = {};
  const t = getAuthToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const tenantId = getTenantId();
  if (tenantId) headers['x-tenant-id'] = String(tenantId);

  return headers;
}

/* =========================
 * Fetch wrapper
 * =======================*/
async function apiFetch(path, init = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),      // d’abord nos en-têtes d’auth
    ...(init.headers || {}), // puis les surcharges éventuelles de l’appelant
  };
  return fetch(url, { ...init, headers });
}

/* =========================
 * Logout
 * =======================*/
function logout() {
  AUTH_TOKEN = '';
  // On pourrait aussi déléguer à auth/state.js le nettoyage du tenant,
  // mais on ne touche pas ici pour garder ce module générique.
}

/* =========================
 * Convenience methods
 * =======================*/
async function get(path, options = {}) {
  return apiFetch(path, { ...options, method: 'GET' });
}

async function post(path, body, options = {}) {
  return apiFetch(path, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function put(path, body, options = {}) {
  return apiFetch(path, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function del(path, options = {}) {
  return apiFetch(path, { ...options, method: 'DELETE' });
}

module.exports = {
  setApiBase,
  getApiBase,
  setAuthToken,
  getAuthToken,
  getAuthHeader,
  apiFetch,
  logout,
  get,
  post,
  put,
  delete: del,
};
