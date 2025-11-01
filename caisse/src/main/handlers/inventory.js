// src/main/handlers/inventory.js
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getDeviceId } = require('../device');

// API base
function readApiBase() {
  try {
    if (process.env.CAISSE_API_URL) return process.env.CAISSE_API_URL.replace(/\/+$/, '');
    const cfgPath = path.join(__dirname, '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg && cfg.api_base_url) return cfg.api_base_url.replace(/\/+$/, '');
  } catch (_) {}
  return 'http://localhost:3001';
}
const API = readApiBase();
const DEFAULT_DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// Token/tenant depuis apiClient/env
let apiMainClient = null;
try { apiMainClient = require('../apiClient'); } catch (_) {}

function resolveAuthContext() {
  let token = null;
  try {
    if (apiMainClient && typeof apiMainClient.getAuthToken === 'function') {
      token = apiMainClient.getAuthToken();
    }
  } catch (_) {}
  if (!token && process.env.API_AUTH_TOKEN) token = process.env.API_AUTH_TOKEN;

  let tenantId = null;
  if (token) {
    try {
      const payload = jwt.decode(token) || {};
      if (payload && payload.tenant_id) tenantId = String(payload.tenant_id);
    } catch (_) {}
  }
  if (!tenantId && process.env.TENANT_ID) tenantId = String(process.env.TENANT_ID);

  return { token, tenantId };
}

function buildJsonHeaders(extra = {}) {
  const { token, tenantId } = resolveAuthContext();
  const headers = { 'content-type': 'application/json', ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  return headers;
}

// fetch avec timeout
async function fetchWithTimeout(url, init = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Normalisations
function normalizeSessionId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}
function normalizeProductId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function normalizeQty(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

module.exports = function registerInventoryHandlers(ipcMain) {
  // Start / reopen
  const handleStart = async (_e, payload = {}) => {
    const name  = payload?.name  || `Inventaire ${new Date().toISOString().slice(0, 10)}`;
    const user  = payload?.user  || null;
    const notes = payload?.notes || null;

    const url = `${API}/inventory/start`;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: buildJsonHeaders(),
        body: JSON.stringify({ name, user, notes }),
      }, 8000);

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`inventory:start HTTP ${res.status} ${txt}`);
      }
      return res.json();
    } catch (e) {
      console.error('[inventory:start] error:', e?.message || e);
      throw e;
    }
  };

  // count-add
  const handleCountAdd = async (_e, payload = {}) => {
    const sessionId = normalizeSessionId(payload?.sessionId ?? payload?.session_id ?? payload?.id);
    const productId = normalizeProductId(payload?.product_id ?? payload?.productId ?? payload?.id);
    const qty       = normalizeQty(payload?.qty ?? payload?.quantite ?? payload?.qte);
    const user      = payload?.user || null;
    const device_id = (payload?.device_id || DEFAULT_DEVICE_ID || '').toString();

    const { token, tenantId } = resolveAuthContext();
    console.log('[inventory:count-add] sessionId=', sessionId, 'productId=', productId, 'qty=', qty, 'token?', !!token, 'tenant?', tenantId || '(none)');

    if (!sessionId) throw new Error('inventory:count-add BAD_ARG sessionId');
    if (productId == null) throw new Error('inventory:count-add BAD_ARG product_id');
    if (qty == null) throw new Error('inventory:count-add BAD_ARG qty');
    if (!device_id) throw new Error('inventory:count-add BAD_ARG device_id');

    const url = `${API}/inventory/${encodeURIComponent(sessionId)}/count-add`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ product_id: productId, qty, user, device_id }),
    }, 8000);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[inventory:count-add] HTTP', res.status, txt);
      throw new Error(`inventory:count-add HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // summary
  const handleSummary = async (_e, payload = {}) => {
    const sessionId = normalizeSessionId(payload?.sessionId ?? payload?.session_id ?? payload?.id);
    if (!sessionId) throw new Error('inventory:summary BAD_ARG sessionId');

    const url = `${API}/inventory/${encodeURIComponent(sessionId)}/summary`;
    const res = await fetchWithTimeout(url, { method: 'GET', headers: buildJsonHeaders() }, 8000);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`inventory:summary HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // finalize
  const handleFinalize = async (_e, payload = {}) => {
    const sessionId = normalizeSessionId(payload?.sessionId ?? payload?.session_id ?? payload?.id);
    if (!sessionId) throw new Error('inventory:finalize BAD_ARG sessionId');

    const user     = payload?.user || null;
    const email_to = payload?.email_to || null;

    const url = `${API}/inventory/${encodeURIComponent(sessionId)}/finalize`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ user, email_to }),
    }, 10000);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`inventory:finalize HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  ipcMain.handle('inventory:start', handleStart);
  ipcMain.handle('inventory:countAdd', handleCountAdd);
  ipcMain.handle('inventory:summary', handleSummary);
  ipcMain.handle('inventory:finalize', handleFinalize);

  // alias rétro
  ipcMain.handle('inventory:count-add', handleCountAdd);
};
