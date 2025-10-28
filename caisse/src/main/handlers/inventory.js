// src/main/handlers/inventory.js
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
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

module.exports = function registerInventoryHandlers(ipcMain) {
  // Démarrer/rouvrir une session d’inventaire
  const handleStart = async (_e, payload = {}) => {
    const name = payload?.name || `Inventaire ${new Date().toISOString().slice(0,10)}`;
    const user = payload?.user || null;
    const notes = payload?.notes || null;

    const res = await fetch(`${API}/inventory/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, user, notes }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`inventory:start HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // Ajouter un comptage (delta) pour un produit
  const handleCountAdd = async (_e, payload = {}) => {
    // conversions robustes
    const sessionId = Number(payload?.sessionId);
    const productId = Number(payload?.product_id ?? payload?.productId ?? payload?.id);
    const qty       = Number(payload?.qty ?? payload?.quantite ?? payload?.qte);
    const user      = payload?.user || null;
    const device_id = (payload?.device_id || DEFAULT_DEVICE_ID || '').toString();

    // petits logs côté main pour debug
    console.log('[inventory:count-add] payload in:', {
      sessionIdRaw: payload?.sessionId, productIdRaw: payload?.product_id ?? payload?.productId ?? payload?.id,
      qtyRaw: payload?.qty ?? payload?.quantite ?? payload?.qte, user, device_id
    });

    // garde-fous côté main (évite des 400 inutiles)
    if (!Number.isFinite(sessionId)) {
      throw new Error('inventory:count-add BAD_ARG sessionId');
    }
    if (!Number.isFinite(productId)) {
      throw new Error('inventory:count-add BAD_ARG product_id');
    }
    if (!Number.isFinite(qty)) {
      throw new Error('inventory:count-add BAD_ARG qty');
    }
    if (!device_id) {
      throw new Error('inventory:count-add BAD_ARG device_id');
    }

    const res = await fetch(`${API}/inventory/${sessionId}/count-add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product_id: productId, qty, user, device_id }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[inventory:count-add] HTTP', res.status, txt);
      throw new Error(`inventory:count-add HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // Résumé de la session (agrégat des quantités)
  const handleSummary = async (_e, payload = {}) => {
    const sessionId = Number(payload?.sessionId);
    const res = await fetch(`${API}/inventory/${sessionId}/summary`);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`inventory:summary HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // Finalisation (écrit les mouvements d’inventaire)
  const handleFinalize = async (_e, payload = {}) => {
    const sessionId = Number(payload?.sessionId);
    const user      = payload?.user || null;
    const email_to  = payload?.email_to || null;

    const res = await fetch(`${API}/inventory/${sessionId}/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, email_to }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`inventory:finalize HTTP ${res.status} ${txt}`);
    }
    return res.json();
  };

  // Canaux “officiels”
  ipcMain.handle('inventory:start', handleStart);
  ipcMain.handle('inventory:countAdd', handleCountAdd); // camelCase
  ipcMain.handle('inventory:summary', handleSummary);
  ipcMain.handle('inventory:finalize', handleFinalize);

  // Alias rétrocompatibles
  ipcMain.handle('inventory:count-add', handleCountAdd); // alias avec tiret
};
