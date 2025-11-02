// src/main/inventory.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { getDeviceId } = require('./device');

// ----- API base (même logique que sync.js) -----
function readApiBase() {
  try {
    if (process.env.CAISSE_API_URL) return process.env.CAISSE_API_URL;
    const cfgPath = path.join(__dirname, '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg && cfg.api_base_url) return cfg.api_base_url;
  } catch (_) {}
  return 'http://localhost:3001';
}
const API_URL = readApiBase();

function notifyRenderer(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send(channel, payload); } catch (_) {}
  });
}

async function apiPost(pathname, body) {
  const res = await fetch(`${API_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  let json = {};
  try { json = JSON.parse(txt); } catch { /* ignore */ }
  if (!res.ok || json?.ok === false) {
    const msg = json?.error ? `${res.status} ${json.error}` : `${res.status} ${txt}`;
    throw new Error(msg);
  }
  return json;
}

async function apiGet(pathname) {
  const res = await fetch(`${API_URL}${pathname}`);
  const txt = await res.text();
  let json = {};
  try { json = JSON.parse(txt); } catch { /* ignore */ }
  if (!res.ok || json?.ok === false) {
    const msg = json?.error ? `${res.status} ${json.error}` : `${res.status} ${txt}`;
    throw new Error(msg);
  }
  return json;
}

function registerInventoryHandlers() {
  const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

  // Créer / réutiliser une session d’inventaire “ouverte”
  ipcMain.handle('inventory:start', async (_evt, { name, user, notes } = {}) => {
    const r = await apiPost('/inventory/start', { name, user, notes });
    notifyRenderer('inventory:session-changed', { session: r.session, reused: r.reused });
    return r;
  });

  // Ajouter (cumuler) une quantité scannée pour un produit depuis CE poste
  ipcMain.handle('inventory:countAdd', async (_evt, { sessionId, product_id, qty, user } = {}) => {
    const payload = { product_id: Number(product_id), qty: Number(qty), device_id: DEVICE_ID, user: user || null };
    const r = await apiPost(`/inventory/${Number(sessionId)}/count-add`, payload);
    // rafraîchir live summary côté renderer si besoin
    notifyRenderer('inventory:count-updated', { sessionId, product_id, qty });
    return r;
  });

  // Récap live (ligne par produit: stock_start, counted_total, deltas, etc.)
  ipcMain.handle('inventory:summary', async (_evt, { sessionId } = {}) => {
    const r = await apiGet(`/inventory/${Number(sessionId)}/summary`);
    return r;
  });

  // Finaliser : calcule les deltas et écrit les mouvements, email optionnel
  ipcMain.handle('inventory:finalize', async (_evt, { sessionId, user, email_to } = {}) => {
    const r = await apiPost(`/inventory/${Number(sessionId)}/finalize`, { user: user || null, email_to: email_to || null });
    notifyRenderer('inventory:session-changed', { session: { id: sessionId, status: 'closed' }, recap: r.recap });
    return r;
  });
}

module.exports = { registerInventoryHandlers };
