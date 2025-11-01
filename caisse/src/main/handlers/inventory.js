// src/main/handlers/inventory.js — v2.2 (robuste aux colonnes manquantes)
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const { getDeviceId } = require('../device');

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

console.log('[inventory] handlers v2.2 loaded — API =', API);

/* -------------------- Utils DB safe -------------------- */
function getDb() {
  return require('../db/db');
}
function listColumns(table) {
  try {
    const db = getDb();
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}
function hasCol(cols, name) {
  return cols.has(name);
}
function normCode(v) {
  return (v == null ? '' : String(v)).replace(/\s+/g, '').trim();
}
function isUuidLike(s) {
  return typeof s === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/* -------------------- Auth headers -------------------- */
function resolveAuthContext() {
  try {
    const authState = require('../auth/state');
    const token =
      (typeof authState.getToken === 'function' && authState.getToken()) ||
      authState.token || process.env.API_AUTH_TOKEN || null;
    const tenantId =
      (typeof authState.getTenantId === 'function' && authState.getTenantId()) ||
      authState.tenantId || process.env.TENANT_ID || null;
    return { token, tenantId };
  } catch {
    return { token: process.env.API_AUTH_TOKEN || null, tenantId: process.env.TENANT_ID || null };
  }
}
function buildJsonHeaders(extra = {}) {
  const { token, tenantId } = resolveAuthContext();
  const headers = { 'content-type': 'application/json', accept: 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId) headers['x-tenant-id'] = String(tenantId);
  return headers;
}

/* -------------------- API calls -------------------- */
async function apiInventoryStart({ name, user, notes }) {
  const res = await fetch(`${API}/inventory/start`, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify({ name, user, notes }),
  });
  if (!res.ok) throw new Error(`inventory:start HTTP ${res.status} ${await res.text().catch(()=> '')}`);
  return res.json();
}
async function apiInventoryCountAdd({ sessionId, product_uuid, qty, user, device_id }) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid.toLowerCase() === 'nan') throw new Error('inventory:count-add BAD_ARG sessionId');
  const res = await fetch(`${API}/inventory/${encodeURIComponent(sid)}/count-add`, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify({ product_id: product_uuid, qty, user, device_id }),
  });
  if (!res.ok) throw new Error(`inventory:count-add HTTP ${res.status} ${await res.text().catch(()=> '')}`);
  return res.json();
}
async function apiInventorySummary(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid.toLowerCase() === 'nan') throw new Error('inventory:summary BAD_ARG sessionId');
  const res = await fetch(`${API}/inventory/${encodeURIComponent(sid)}/summary`, {
    method: 'GET',
    headers: buildJsonHeaders(),
  });
  if (!res.ok) throw new Error(`inventory:summary HTTP ${res.status} ${await res.text().catch(()=> '')}`);
  const js = await res.json();
  const lines = Array.isArray(js?.lines) ? js.lines : [];
  return {
    raw: js,
    lines: lines.map(l => ({
      remote_product_id: l.product_id ?? l.remote_product_id ?? l.remote_id ?? null,
      barcode: normCode(l.barcode ?? l.code_barres ?? l.ean ?? l.code ?? ''),
      counted_total: Number(l.counted_total ?? l.count ?? l.qty ?? 0),
      price: Number(l.prix ?? l.price ?? 0),
    })),
  };
}
async function apiInventoryFinalize(apiBase, token, sessionId, body = {}) {
  const r = await fetch(`${apiBase}/inventory/${encodeURIComponent(sessionId)}/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (r.status === 409) {
    // Ex: {"ok":false,"error":"session_locked"}
    let msg = '';
    try { const j = await r.json(); msg = j?.error || ''; } catch {}
    if (msg === 'session_locked') {
      // 👉 Considérer comme déjà finalisé
      return { ok: true, alreadyFinalized: true, recap: null };
    }
  }

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`inventory:finalize HTTP ${r.status} ${txt}`);
  }
  return r.json();
}

/* -------------------- Mapping helpers -------------------- */
function resolveRemoteProductUUID(localId) {
  const db = getDb();
  const cols = listColumns('produits');

  // Colonnes UUID candidates disponibles
  const uuidCandidates = ['remote_uuid', 'remote_id', 'neon_id', 'product_uuid', 'uuid'].filter(c => hasCol(cols, c));
  // Colonnes code-barres disponibles
  const barcodeCols = ['code_barres', 'code', 'ean'].filter(c => hasCol(cols, c));

  // Construire dynamiquement la requête
  const selectUuid = uuidCandidates.length
    ? `COALESCE(${uuidCandidates.join(', ')}, NULL) AS candidate`
    : `NULL AS candidate`;
  const selectBarcode = barcodeCols.map(c => `COALESCE(${c}, '')`).join(', ');
  const selectAll =
    `SELECT ${selectUuid}` +
    (barcodeCols.length ? `, ${barcodeCols.map(c => `COALESCE(${c}, '') AS ${c}`).join(', ')}` : '') +
    ` FROM produits WHERE id = ?`;

  let row;
  try {
    row = db.prepare(selectAll).get(Number(localId));
  } catch (e) {
    // Si la requête échoue quand même, retourner "pas d’UUID"
    return { uuid: null, barcode: null };
  }
  if (!row) return { uuid: null, barcode: null };

  const uu = row.candidate && isUuidLike(String(row.candidate)) ? String(row.candidate) : null;

  let bc = null;
  for (const c of barcodeCols) {
    const v = normCode(row[c]);
    if (v) { bc = v; break; }
  }
  return { uuid: uu, barcode: bc };
}

function applySummaryToLocal(lines) {
  const db = getDb();
  const cols = listColumns('produits');

  // Colonnes présentes
  const uuidCols = ['remote_uuid', 'remote_id', 'neon_id', 'product_uuid', 'uuid'].filter(c => hasCol(cols, c));
  const barcodeCols = ['code_barres', 'code', 'ean'].filter(c => hasCol(cols, c));

  // SELECT dynamique
  const selectUuid = uuidCols.length
    ? `COALESCE(${uuidCols.join(', ')}, '') AS remote_uuid`
    : `'' AS remote_uuid`;
  const selectBarcodes = barcodeCols.length
    ? `, ${barcodeCols.map(c => `COALESCE(${c}, '') AS ${c}`).join(', ')}`
    : '';
  const produitsQuery = `
    SELECT id, ${selectUuid}
    ${selectBarcodes}
    FROM produits
  `;

  let produits = [];
  try {
    produits = db.prepare(produitsQuery).all();
  } catch (e) {
    console.warn('[inventory] applySummaryToLocal: SELECT produits failed:', e?.message || e);
    return { matched: 0, total: 0 };
  }

  const byUuid = new Map();
  const byBarcode = new Map();

  for (const p of produits) {
    if (p.remote_uuid && isUuidLike(String(p.remote_uuid))) byUuid.set(String(p.remote_uuid), Number(p.id));
    for (const c of barcodeCols) {
      const v = normCode(p[c]);
      if (v && !byBarcode.has(v)) byBarcode.set(v, Number(p.id));
    }
  }

  // map lines -> local ids
  const mapped = new Map();
  for (const l of lines) {
    const qty = Number(l.counted_total || 0);
    if (!Number.isFinite(qty)) continue;

    let localId = null;
    const rid = l.remote_product_id && String(l.remote_product_id);
    if (rid && isUuidLike(rid) && byUuid.has(rid)) {
      localId = byUuid.get(rid);
    } else {
      const bc = normCode(l.barcode);
      if (bc && byBarcode.has(bc)) localId = byBarcode.get(bc);
    }
    if (localId) mapped.set(localId, qty);
  }

  const stmtZeroAll  = db.prepare(`UPDATE produits SET stock = 0`);
  const stmtSetStock = db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    stmtZeroAll.run();
    for (const [id, s] of mapped.entries()) stmtSetStock.run(s, id);
  });
  tx();

  try {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('data:refreshed', { from: 'inventory:finalize' }));
  } catch {}

  console.log(`[inventory] stocks locaux mis à jour via summary — matched ${mapped.size}/${produits.length}`);
  return { matched: mapped.size, total: produits.length };
}

/* -------------------- IPC -------------------- */
module.exports = function registerInventoryHandlers(ipcMain) {
  ipcMain.handle('inventory:start', async (_e, payload = {}) => {
    const name  = payload?.name  || `Inventaire ${new Date().toISOString().slice(0,10)}`;
    const user  = payload?.user  || null;
    const notes = payload?.notes || null;
    return apiInventoryStart({ name, user, notes });
  });

  const doCountAdd = async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    const qty       = Number(payload?.qty ?? payload?.quantite ?? payload?.qte);
    const user      = payload?.user || null;
    const device_id = (payload?.device_id || DEFAULT_DEVICE_ID || '').toString();
    if (!Number.isFinite(qty)) throw new Error('inventory:count-add BAD_ARG qty');
    if (!device_id) throw new Error('inventory:count-add BAD_ARG device_id');

    const localProductId = (payload?.product_id ?? payload?.productId ?? payload?.id);
    const localNum = Number(localProductId);
    if (!Number.isFinite(localNum)) throw new Error('inventory:count-add BAD_ARG product (local id attendu)');

    const { uuid: remoteUUID } = resolveRemoteProductUUID(localNum);
    if (!remoteUUID) {
      // Pas d’UUID → on ne tente pas l’API, on explique clairement quoi faire
      throw new Error('inventory:count-add MAPPING_MISSING — aucun remote_uuid. Lance le bootstrap des références ou renseigne remote_uuid sur ce produit.');
    }
    return apiInventoryCountAdd({ sessionId, product_uuid: remoteUUID, qty, user, device_id });
  };
  ipcMain.handle('inventory:countAdd', doCountAdd);
  ipcMain.handle('inventory:count-add', doCountAdd);

  ipcMain.handle('inventory:summary', async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    return (await apiInventorySummary(sessionId)).raw;
    // (renderer fait déjà l’agrégation nécessaire)
  });

ipcMain.handle('inventory:finalize', async (_evt, { sessionId, user } = {}) => {
  if (!sessionId) throw new Error('inventory:finalize BAD_ARG sessionId');

  try {
    const { token } = resolveAuthContext();        // ← token courant (Bearer)
    const out = await apiInventoryFinalize(API,    // ← use API (defined at top), not API_BASE
      token,
      String(sessionId),
      { user }
    );

    // Optionnel : MAJ du stock local depuis le résumé
    // try {
    //   const sum = await apiInventorySummary(String(sessionId));
    //   applySummaryToLocal(sum.lines);
    // } catch (e) {
    //   console.warn('[inventory] applySummaryToLocal failed:', e);
    // }

    if (out?.alreadyFinalized) {
      return { ok: true, recap: out.recap || null, alreadyFinalized: true };
    }
    return out;
  } catch (e) {
    console.error('inventory:finalize error', e);
    throw e;
  }
});
};


