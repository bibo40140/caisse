// src/main/apiClient.js (CommonJS)
let API_BASE = '';
let AUTH_TOKEN = '';

function setApiBase(url) {
  API_BASE = (url || '').replace(/\/+$/, '');
}

function setAuthToken(token) {
  AUTH_TOKEN = token || '';
}

function getHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (AUTH_TOKEN) h.Authorization = `Bearer ${AUTH_TOKEN}`;
  return h;
}

// helpers si tu veux t’en servir ailleurs
async function apiGet(pathname) {
  const r = await fetch(`${API_BASE}${pathname}`, { headers: getHeaders() });
  const js = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data: js };
}

async function apiPost(pathname, body) {
  const r = await fetch(`${API_BASE}${pathname}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body || {}),
  });
  const js = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data: js };
}

module.exports = {
  setApiBase,
  setAuthToken,
  apiGet,
  apiPost,
};
