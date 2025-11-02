// caisse/renderer/lib/apiClient.js

// 1) Base URL de l'API
const API_URL = window.API_URL || (window.localStorage.getItem('API_URL') || 'http://localhost:3001');

// 2) Gestion du token en localStorage
function getToken() {
  return window.localStorage.getItem('JWT_TOKEN') || '';
}
function setToken(token) {
  if (token) window.localStorage.setItem('JWT_TOKEN', token);
}
function clearToken() {
  window.localStorage.removeItem('JWT_TOKEN');
}

// 3) fetch JSON avec Authorization auto si token présent
async function fetchJSON(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const headers = new Headers(opts.headers || {});
  headers.set('Content-Type', 'application/json');

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || 'HTTP error');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// 4) Auth helpers
async function login(email, password) {
  const r = await fetchJSON('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (r?.token) setToken(r.token);
  return r;
}

async function registerTenant(tenant_name, email, password) {
  const r = await fetchJSON('/auth/register-tenant', {
    method: 'POST',
    body: JSON.stringify({ tenant_name, email, password })
  });
  if (r?.token) setToken(r.token);
  return r;
}

// 5) Sync helpers (protégés)
async function syncBootstrapNeeded() {
  return fetchJSON('/sync/bootstrap_needed');
}
async function syncPullRefs() {
  return fetchJSON('/sync/pull_refs');
}
async function syncBootstrap(payload) {
  return fetchJSON('/sync/bootstrap', { method: 'POST', body: JSON.stringify(payload) });
}
async function syncPushOps(payload) {
  return fetchJSON('/sync/push_ops', { method: 'POST', body: JSON.stringify(payload) });
}

window.ApiClient = {
  API_URL,
  getToken, setToken, clearToken,
  fetchJSON,
  login, registerTenant,
  syncBootstrapNeeded, syncPullRefs, syncBootstrap, syncPushOps,
};
