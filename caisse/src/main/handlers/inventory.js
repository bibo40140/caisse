// src/main/handlers/inventory.js — v2.7 (session explicite, closeAllOpen, fixes matching & COALESCE)
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const { getDeviceId } = require('../device');
const { enqueueOp } = require('../db/ops');
const db = require('../db/db');
const { createStockMovement, getStock } = require('../db/stock');

const { getConfig } = require('../config');
function readApiBase() {
  if (process.env.CAISSE_API_URL) return process.env.CAISSE_API_URL.replace(/\/+$/, '');
  const cfg = getConfig();
  return (cfg.api_base_url || 'https://caisse-api-xxxx.onrender.com').replace(/\/+$/, '');
}
const API = readApiBase();
const DEFAULT_DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

console.log('[inventory] handlers v2.7 loaded — API =', API);

/* -------------------- Utils DB safe -------------------- */
function getDb() { return require('../db/db'); }
function listColumns(table) {
  try {
    const db = getDb();
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map(r => r.name));
  } catch { return new Set(); }
}
function hasCol(cols, name) { return cols.has(name); }
function normCode(v) { return (v == null ? '' : String(v)).replace(/\s+/g, '').trim(); }
function isUuidLike(s) {
  return typeof s === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function statusOf(s) {
  return String(s ?? '').toLowerCase();
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
    body: JSON.stringify({ produit_id: product_uuid, qty, user, device_id }),
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    console.warn('[inventory] count-add failed', res.status, body);
    throw new Error(`inventory:count-add HTTP ${res.status} ${body}`);
  }
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
    lines: lines, // Retourner TOUTES les données de l'API sans filtrage
  };
}
async function apiInventoryCounts(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid || sid.toLowerCase() === 'nan') throw new Error('inventory:counts BAD_ARG sessionId');
  const res = await fetch(`${API}/inventory/${encodeURIComponent(sid)}/counts`, {
    method: 'GET',
    headers: buildJsonHeaders(),
  });
  if (!res.ok) throw new Error(`inventory:counts HTTP ${res.status} ${await res.text().catch(()=> '')}`);
  const js = await res.json();
  return js?.counts || [];
}

async function apiInventoryFinalize(apiBase, token, sessionId, body = {}) {
  const r = await fetch(`${apiBase}/inventory/${encodeURIComponent(sessionId)}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (r.status === 409) {
    let msg = '';
    try { const j = await r.json(); msg = j?.error || ''; } catch {}
    if (msg === 'session_locked') return { ok: true, alreadyFinalized: true, recap: null };
  }
  if (!r.ok) throw new Error(`inventory:finalize HTTP ${r.status} ${await r.text()}`);
  return r.json();
}
async function apiInventoryListSessions() {
  const r = await fetch(`${API}/inventory/sessions`, {
    method: 'GET',
    headers: buildJsonHeaders(),
  });
  if (!r.ok) throw new Error(`inventory:sessions HTTP ${r.status} ${await r.text().catch(()=> '')}`);
  const js = await r.json();
  if (Array.isArray(js?.sessions)) return js.sessions;
  if (Array.isArray(js?.items))    return js.items;
  if (Array.isArray(js))           return js;
  return [];
}

/* -------------------- Apply summary to local DB -------------------- */
function applySummaryToLocal(lines) {
  console.log(`\n   📋 applySummaryToLocal appelé avec ${lines?.length || 0} lignes`);
  
  const db = getDb();

  // Standardiser sur remote_uuid uniquement
  const produitsQuery = `SELECT id, stock, COALESCE(remote_uuid, '') AS remote_uuid, COALESCE(code_barre, '') AS code_barre, nom FROM produits`;

  let produits = [];
  try { produits = db.prepare(produitsQuery).all(); } catch { 
    console.error(`   ❌ Erreur lecture produits`);
    return { matched: 0, total: 0 }; 
  }

  const byUuid = new Map(); 
  const byBarcode = new Map();
  for (const p of produits) {
    if (p.remote_uuid && isUuidLike(String(p.remote_uuid))) byUuid.set(String(p.remote_uuid), Number(p.id));
    const bc = normCode(p.code_barre);
    if (bc && !byBarcode.has(bc)) byBarcode.set(bc, Number(p.id));
  }

  const mapped = new Map();
  for (const l of lines) {
    const qty = Number(l.counted_total || 0);
    if (!Number.isFinite(qty)) continue;
    let localId = null;
    
    // Priorité 1: remote_produit_id (UUID)
    const rid = l.remote_produit_id && String(l.remote_produit_id);
    if (rid && isUuidLike(rid) && byUuid.has(rid)) {
      localId = byUuid.get(rid);
    } 
    // Priorité 2: fallback sur barcode si UUID non trouvé
    else { 
      const bc = normCode(l.barcode); 
      if (bc && byBarcode.has(bc)) localId = byBarcode.get(bc); 
    }
    
    if (localId) {
      mapped.set(localId, qty);
      // Log uniquement les produits comptés (qty > 0)
      if (qty > 0) {
        console.log(`   🔍 ${l.nom || 'Unknown'} → compté=${qty} (match: ${rid ? 'UUID' : 'barcode'})`);
      }
    }
  }
  
  console.log(`   ℹ️  ${mapped.size} produits mappés`);

  // Appliquer le stock inventorié de manière ABSOLUE (pas de delta)
  console.log(`\n   🔄 Application des stocks:`);
  const createdMovements = [];
  const tx = db.transaction(() => {
    for (const [id, inventoriedStock] of mapped.entries()) {
      // Récupérer les infos AVANT modification
      const beforeRow = db.prepare(`SELECT stock, nom, remote_uuid FROM produits WHERE id = ?`).get(id);
      const stockBeforeInventory = beforeRow ? Number(beforeRow.stock || 0) : 0;
      const nomProduit = beforeRow?.nom || `ID=${id}`;
      
      // Log uniquement si stock compté > 0 (produits inventoriés)
      if (inventoriedStock > 0) {
        console.log(`   📦 ${nomProduit}:`);
        console.log(`      Stock AVANT: ${stockBeforeInventory}`);
        console.log(`      Inventorié:  ${inventoriedStock}`);
      }
      
      // Calculer le delta basé sur le stock AVANT inventaire
      const delta = inventoriedStock - stockBeforeInventory;
      
      // Appliquer le nouveau stock de manière absolue
      db.prepare(`UPDATE produits SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(inventoriedStock, id);
      
      // Vérifier que l'update a bien fonctionné
      const afterRow = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(id);
      const stockAfter = afterRow ? Number(afterRow.stock || 0) : 0;
      
      if (inventoriedStock > 0) {
        console.log(`      Stock APRÈS: ${stockAfter}`);
        if (stockAfter !== inventoriedStock) {
          console.error(`      ❌ ANOMALIE DÉTECTÉE: stock=${stockAfter} mais devrait être ${inventoriedStock}`);
        }
      }
      
      // Créer un mouvement pour traçabilité et enqueue l'opération
      if (delta !== 0) {
        const movementId = db.prepare(`
          INSERT INTO stock_movements (produit_id, delta, source, source_id, meta, created_at)
          VALUES (?, ?, 'inventory', NULL, ?, datetime('now','localtime'))
        `).run(id, delta, JSON.stringify({ 
          stock_before: stockBeforeInventory,
          stock_after: inventoriedStock,
          delta: delta
        })).lastInsertRowid;
        
        // Enqueue l'opération pour push vers serveur
        createdMovements.push({
          movementId,
          produit_id: id,
          produit_uuid: beforeRow?.remote_uuid || null,
          delta,
          stock_before: stockBeforeInventory,
          stock_after: inventoriedStock
        });
      }
    }
  }); tx();
  
  // Enqueue les opérations APRÈS la transaction (hors de la tx)
  for (const mov of createdMovements) {
    try {
      enqueueOp({
        deviceId: DEFAULT_DEVICE_ID,
        opType: 'stock.movement_created',
        entityType: 'stock_movement',
        entityId: mov.movementId,
        payload: {
          movement_id: mov.movementId,
          produit_id: mov.produit_id,
          produit_uuid: mov.produit_uuid,
          delta: mov.delta,
          stock_before: mov.stock_before,
          stock_after: mov.stock_after,
          source: 'inventory'
        }
      });
    } catch (e) {
      console.warn(`[inventory] Erreur enqueueOp pour movement ${mov.movementId}:`, e?.message);
    }
  }
  
  console.log(`   📤 ${createdMovements.length} mouvements enqueued pour push serveur`);

  try { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('data:refreshed', { from: 'inventory:finalize' })); } catch {}
  console.log(`\n   ✅ Stocks mis à jour: ${mapped.size}/${produits.length} produits matchés\n`);
  return { matched: mapped.size, total: produits.length };
}

/* -------------------- Defensive IPC register -------------------- */
function safeHandle(ipcMain, channel, handler) {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, handler);
}

/**
 * Génère un bilan HTML pour le rapport d'inventaire
 */
function generateInventoryReportHTML(session, lines) {
  const date = new Date(session?.started_at || Date.now()).toLocaleString('fr-FR');
  
  const counted = lines.filter(l => Number(l.counted_total || 0) > 0).length;
  const total = lines.length;
  const totalValue = lines.reduce((acc, l) => {
    const qty = Number(l.counted_total || 0);
    const price = Number(l.price || 0);
    return acc + (qty * price);
  }, 0);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px; }
        .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
        .stat-card.highlight { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; }
        .stat-label { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
        .stat-card.highlight .stat-label { color: rgba(255,255,255,0.9); }
        .stat-value { font-size: 28px; font-weight: 700; margin: 8px 0; }
        .section { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; overflow-x: auto; }
        .section h2 { margin-top: 0; color: #1f2937; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 13px; font-weight: 600; }
        td { padding: 10px; }
        tr:hover { background: #f9fafb; }
        .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📦 Bilan d'Inventaire</h1>
        <p>${session?.name || 'Inventaire'} — ${date}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card highlight">
          <div class="stat-label">Produits inventoriés</div>
          <div class="stat-value">${counted}/${total}</div>
          <div class="stat-label" style="color: rgba(255,255,255,0.9);">${((counted/total)*100).toFixed(1)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Valeur totale</div>
          <div class="stat-value">${totalValue.toFixed(2)} €</div>
          <div class="stat-label">Stocks comptés</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Nombre de lignes</div>
          <div class="stat-value">${total}</div>
          <div class="stat-label">Articles uniques</div>
        </div>
      </div>

      <div class="section">
        <p style="color: #6b7280; margin: 0;">
          📎 <strong>Le détail complet de l'inventaire</strong> (tous les produits) est disponible dans le fichier CSV en pièce jointe.
        </p>
      </div>

      <div class="footer">
        <p>Ce rapport a été généré automatiquement par votre système de caisse.</p>
        <p>Pour toute question, veuillez contacter votre administrateur.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Génère un CSV pour l'inventaire
 */
function generateInventoryCSV(session, lines) {
  const escape = (v) => {
    const s = String(v ?? '');
    return (/[",;\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  
  const header = ['produit_id', 'nom', 'code_barre', 'stock_initial', 'compte', 'ecart', 'prix_unitaire', 'valeur_comptee'];
  const body = (lines || []).map(l => {
    const start = Number(l.stock_start || 0);
    const counted_total = Number(l.counted_total || 0);
    const delta = counted_total - start;
    const price = Number(l.prix || l.price || 0);
    const value = counted_total * price;
    
    return [
      escape(l.produit_id || ''),
      escape(l.nom || ''),
      escape(l.code_barre || ''),
      String(start),
      String(counted_total),
      String(delta),
      price.toFixed(2),
      value.toFixed(2)
    ].join(';');
  });
  
  return [header.join(';'), ...body].join('\n');
}

/**
 * Envoie le bilan d'inventaire par email
 */
async function sendInventoryEmail(sessionData, lines) {
  try {
    const { sendEmailReport: sendEmail, getEmailConfig } = require('../emailReports');
    const { emailCompta, smtpConfig } = await getEmailConfig();
    
    if (!emailCompta || !smtpConfig) {
      console.warn('[inventory] Email comptable non configuré ou SMTP invalide');
      return false;
    }
    
    // Debug: afficher la structure des données
    console.log('[inventory] DEBUG - First line structure:', lines?.[0] ? Object.keys(lines[0]) : 'NO LINES');
    
    const date = new Date(sessionData?.started_at || Date.now());
    const dateStr = date.toLocaleString('fr-FR');
    const sessionName = sessionData?.name || `Inventaire ${date.toISOString().slice(0, 10)}`;
    
    // Générer le HTML du bilan
    const htmlContent = generateInventoryReportHTML(sessionData, lines);
    
    // Générer le CSV
    const csvContent = generateInventoryCSV(sessionData, lines);
    
    const subject = `[Inventaire] ${sessionName} - ${dateStr}`;
    
    console.log('[inventory] Envoi du bilan par email à:', emailCompta);
    const sent = await sendEmail(emailCompta, subject, htmlContent, smtpConfig, { csv: csvContent, filename: `${sessionName.replace(/[^\w\-]+/g, '_')}.csv` });
    
    if (sent) {
      console.log('[inventory] ✅ Bilan d\'inventaire envoyé à', emailCompta);
    } else {
      console.warn('[inventory] ❌ Impossible d\'envoyer le bilan par email');
    }
    
    return sent;
  } catch (e) {
    console.warn('[inventory] Erreur lors de l\'envoi du bilan:', e?.message || e);
    return false;
  }
}

/* -------------------- IPC -------------------- */
module.exports = function registerInventoryHandlers(ipcMain) {
  safeHandle(ipcMain, 'inventory:start', async (_e, payload = {}) => {
    const name  = payload?.name  || `Inventaire ${new Date().toISOString().slice(0,10)}`;
    const user  = payload?.user  || null;
    const notes = payload?.notes || null;

    // 1) Create a local session row (always available offline)
    const insert = db.prepare(`INSERT INTO inventory_sessions (name, status, started_at) VALUES (?, 'open', datetime('now','localtime'))`);
    const info = insert.run(name);
    const localSessionId = info.lastInsertRowid;

    // 2) Try to create remote session now; if OK, update local remote_uuid and return remote session
    try {
      const js = await apiInventoryStart({ name, user, notes });
      const remoteId = js?.session?.id || js?.id || null;
      if (remoteId) {
        try { db.prepare(`UPDATE inventory_sessions SET remote_uuid = ? WHERE id = ?`).run(String(remoteId), localSessionId); } catch (_) {}
        return { session: { id: String(remoteId), local_id: localSessionId }, reused: !!js?.reused };
      }
    } catch (e) {
      // offline or API error: enqueue an op to create remote session later
      try {
        enqueueOp({ deviceId: DEFAULT_DEVICE_ID, opType: 'inventory.session_start', entityType: 'inventory_session', entityId: localSessionId, payload: { local_session_id: localSessionId, name, user, notes } });
      } catch (ee) { /* non blocking */ }
    }

    // Return local session id so renderer can work offline
    return { session: { id: String(localSessionId), local_id: localSessionId }, reused: false };
  });

  const doCountAdd = async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    const qty       = Number(payload?.qty ?? payload?.quantite ?? payload?.qte);
    const user      = payload?.user || null;
    const device_id = (payload?.device_id || DEFAULT_DEVICE_ID || '').toString();
    if (!Number.isFinite(qty)) throw new Error('inventory:count-add BAD_ARG qty');
    if (!device_id) throw new Error('inventory:count-add BAD_ARG device_id');

    const productIdInput = (payload?.produit_id ?? payload?.productId ?? payload?.id);
    if (!productIdInput) throw new Error('inventory:count-add BAD_ARG produit_id requis');

    const db = getDb();
    
    // Convertir sessionId UUID → ID local si nécessaire
    // FIX: Get the MOST RECENT session (ORDER BY id DESC) to avoid hitting old duplicates
    let localSessionId = sessionId;
    if (isUuidLike(String(sessionId))) {
      const sessRow = db.prepare(`SELECT id FROM inventory_sessions WHERE remote_uuid = ? ORDER BY id DESC LIMIT 1`).get(String(sessionId));
      if (!sessRow) throw new Error(`Session UUID ${sessionId} not found locally`);
      localSessionId = sessRow.id;
      console.log(`[inventory:count-add] SessionId converted: UUID ${sessionId} → local_id=${localSessionId}`);
    }
    
    const cols = listColumns('produits');
    const uuidCols = ['remote_uuid', 'remote_id', 'neon_id', 'product_uuid', 'uuid'].filter(c => hasCol(cols, c));
    const selectUuid = uuidCols.length ? `COALESCE(${uuidCols.join(', ')}, '')` : 'NULL';

    let row = null;
    let localNum = null;
    let remoteUUID = null;

    // Détecter si on reçoit un UUID ou un ID local
    const isUuid = isUuidLike(String(productIdInput));
    
    if (isUuid) {
      // On reçoit un UUID → trouver l'ID local
      try {
        row = db.prepare(`SELECT id, ${selectUuid} AS remote_uuid FROM produits WHERE remote_uuid = ?`).get(String(productIdInput));
        if (!row) throw new Error(`Produit avec UUID ${productIdInput} non trouvé localement`);
        localNum = row.id;
        remoteUUID = String(productIdInput);
      } catch (e) {
        throw new Error(`inventory:count-add: produit UUID ${productIdInput} introuvable: ${e.message}`);
      }
    } else {
      // On reçoit un ID local → trouver l'UUID
      localNum = Number(productIdInput);
      if (!Number.isFinite(localNum)) throw new Error('inventory:count-add BAD_ARG product (ni ID ni UUID valide)');
      try {
        row = db.prepare(`SELECT ${selectUuid} AS remote_uuid FROM produits WHERE id = ?`).get(localNum);
        remoteUUID = row?.remote_uuid && isUuidLike(String(row.remote_uuid)) ? String(row.remote_uuid) : null;
      } catch {}
    }

    // 1) Always persist locally to inventory_counts for offline use / UI
    try {
      db.prepare(`INSERT INTO inventory_counts (session_id, produit_id, qty, user, device_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))`).run(localSessionId, localNum, qty, user, device_id);
      console.log(`\n🔵 [INVENTAIRE] COMPTAGE ligne validée:`);
      console.log(`   Produit: ${row?.nom || 'ID=' + localNum}`);
      console.log(`   Quantité: ${qty}`);
      console.log(`   Session locale: ${localSessionId}`);
      console.log(`   Session UUID: ${sessionId}`);
    } catch (e) { 
      console.error(`\n❌ [INVENTAIRE] Erreur persist local count:`, e?.message || e);
    }

    // 2) Appeler l'API directement pour synchronisation immédiate (multiposte)
    // Ne PAS enqueue car cela créerait un double comptage (l'API est déjà appelée ici)
    if (remoteUUID) {
      console.log(`   📡 Envoi à l'API: UUID=${remoteUUID.slice(0,8)}... qty=${qty}`);
      try { 
        await apiInventoryCountAdd({ sessionId, product_uuid: remoteUUID, qty, user, device_id });
        console.log(`   ✅ API sync OK\n`);
        return { ok: true, synced: true };
      } catch (e) {
        console.error(`   ❌ Erreur API sync:`, e?.message || e); 
        console.warn('[inventory] count-add API failed, will retry later:', e?.message || e);
        // Si l'API échoue, enqueue pour retry
        try {
          enqueueOp({ deviceId: DEFAULT_DEVICE_ID, opType: 'inventory.count_add', entityType: 'inventory', entityId: sessionId, payload: { session_id: sessionId, local_produit_id: localNum, product_uuid: remoteUUID, qty, user, device_id } });
          return { ok: true, queued: true };
        } catch (e2) { 
          console.warn('[inventory] enqueueOp failed', e2?.message || e2);
          return { ok: true, local_only: true };
        }
      }
    }
    console.log(`[inventory:count-add] ❌ No remoteUUID found for product ${productIdInput} (local_id=${localNum}), sending local_only`);
    return { ok: true, local_only: true };
  };
  safeHandle(ipcMain, 'inventory:countAdd', doCountAdd);
  safeHandle(ipcMain, 'inventory:count-add', doCountAdd);

  safeHandle(ipcMain, 'inventory:summary', async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    return (await apiInventorySummary(sessionId)).raw;
  });

  safeHandle(ipcMain, 'inventory:markFinished', async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    const device_id = payload?.device_id || DEFAULT_DEVICE_ID;
    if (!sessionId) throw new Error('inventory:markFinished BAD_ARG sessionId');
    
    const { token } = resolveAuthContext();
    const res = await fetch(`${API}/inventory/${encodeURIComponent(sessionId)}/mark-finished`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device_id })
    });

    let rawBody = null;
    try {
      rawBody = await res.text();
      console.log('[markFinished] API response:', rawBody);
      const json = JSON.parse(rawBody);
      if (!res.ok || !json.ok) {
        throw new Error(`markFinished HTTP ${res.status} ${rawBody}`);
      }
      return json;
    } catch (e) {
      // Si le body n'est pas JSON ou autre erreur
      throw new Error(`markFinished HTTP ${res.status} ${rawBody || e.message}`);
    }
  });

  safeHandle(ipcMain, 'inventory:getDeviceStatus', async (_e, payload = {}) => {
    const sessionId = payload?.sessionId;
    if (!sessionId) throw new Error('inventory:getDeviceStatus BAD_ARG sessionId');
    
    const { token } = resolveAuthContext();
    const res = await fetch(`${API}/inventory/${encodeURIComponent(sessionId)}/device-status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getDeviceStatus HTTP ${res.status} ${body}`);
    }
    
    return await res.json();
  });

  safeHandle(ipcMain, 'inventory:finalize', async (_evt, { sessionId, user } = {}) => {
    console.log(`\n\n🟢 ========== [INVENTAIRE] DÉBUT FINALISATION ==========`);
    console.log(`   Session ID reçu: ${sessionId} (type: ${typeof sessionId})`);
    
    if (!sessionId) throw new Error('inventory:finalize BAD_ARG sessionId');
    const { token } = resolveAuthContext();
    // If sessionId is a local numeric id, try to find a remote_uuid
    let lookedUpRemote = null;
    try {
      const n = Number(sessionId);
      if (Number.isFinite(n)) {
        const row = db.prepare(`SELECT remote_uuid FROM inventory_sessions WHERE id = ?`).get(n);
        if (row?.remote_uuid) lookedUpRemote = String(row.remote_uuid);
        console.log(`   Conversion ID local → UUID: ${n} → ${lookedUpRemote}`);
      }
    } catch (_) {}

    // If we have a remote session id (either passed directly or looked up), try to finalize now
    const effectiveRemoteId = lookedUpRemote || (isUuidLike(String(sessionId)) ? String(sessionId) : null);
    console.log(`   Session UUID effective: ${effectiveRemoteId}\n`);
    
    if (effectiveRemoteId) {
      // 1) Finalise côté API
      console.log(`🔵 [INVENTAIRE] Étape 1/4: Appel API finalize...`);
      const out = await apiInventoryFinalize(API, token, String(effectiveRemoteId), { user });
      console.log(`   ✅ API finalize OK\n`);

      // 2) Récupère le summary et applique aux stocks locaux
      console.log(`🔵 [INVENTAIRE] Étape 2/4: Récupération summary API...`);
      try {
        const sum = await apiInventorySummary(String(effectiveRemoteId));
        console.log(`   ✅ Summary reçu: ${sum?.lines?.length || 0} produits`);
        const countedLines = (sum?.lines || []).filter(l => Number(l.counted_total || 0) > 0);
        console.log(`   📊 Produits comptés: ${countedLines.length}`);
        if (countedLines.length > 0) {
          console.log(`   Exemples:`);
          countedLines.slice(0, 3).forEach(l => {
            console.log(`      - ${l.nom}: counted_total=${l.counted_total}`);
          });
        }
        console.log(`\n🔵 [INVENTAIRE] Étape 3/4: Application stocks locaux...`);
        applySummaryToLocal(sum.lines);
      } catch (e) {
        console.error(`\n❌ [INVENTAIRE] Erreur applySummaryToLocal:`, e?.message || e);
      }

      // 3) Récupère le summary AVANT de fermer la session (nécessaire pour l'email)
      let summaryDataForEmail = null;
      try {
        summaryDataForEmail = await apiInventorySummary(String(effectiveRemoteId));
      } catch (e) {
        console.warn('[inventory] Summary retrieval for email failed:', e?.message || e);
      }

      // 4) Mark local session(s) closed - update by remote_uuid to catch all terminals
      console.log(`🔵 [INVENTAIRE] Étape 4/4: Fermeture session locale...`);
      try {
        db.prepare(`UPDATE inventory_sessions SET status='closed', ended_at=datetime('now','localtime') WHERE remote_uuid = ?`).run(String(effectiveRemoteId));
        console.log(`   ✅ Session fermée\n`);
      } catch (_) {}

      // 5) Notifier TOUTES les fenêtres que la session est clôturée → purge UI
      try {
        const payload = { sessionId: String(sessionId), closed: true, at: Date.now() };
        BrowserWindow.getAllWindows().forEach(w => w.webContents.send('inventory:session-closed', payload));
      } catch (_) {}

      // 6) Envoyer le bilan par email au comptable (utilise la donnée sauvegardée avant fermeture)
      console.log(`📧 [INVENTAIRE] Envoi email bilan...`);
      try {
        if (summaryDataForEmail?.lines) {
          // Créer un objet session avec les infos minimales nécessaires
          const sessionInfo = {
            name: `Inventaire ${new Date().toISOString().slice(0, 10)}`,
            started_at: new Date().toISOString()
          };
          sendInventoryEmail(sessionInfo, summaryDataForEmail.lines);
        }
      } catch (e) {
        console.warn('[inventory] Email send failed (non bloquant):', e?.message || e);
      }

      // 7) 🔥 PUSH des stocks d'inventaire vers le serveur pour persister
      console.log(`🔄 [INVENTAIRE] Push des modifications vers serveur...`);
      try {
        const { pushOpsNow } = require('../sync');
        const pushRes = await pushOpsNow(DEFAULT_DEVICE_ID);
        console.log(`   ✅ Push réussi: ${pushRes.sent} opération(s) envoyée(s)`);
      } catch (e) {
        console.warn('[inventory] Push failed (non bloquant):', e?.message || e);
      }

      if (out?.alreadyFinalized) return { ok: true, recap: out.recap || null, alreadyFinalized: true };
  console.log(`\n🟢 ========== [INVENTAIRE] FIN FINALISATION OK ==========\n\n`);
  return out;
    }

    // Otherwise (no remote id): operate offline — calculate deltas locally, create stock movements, save summary
    try {
      const n = Number(sessionId);
      if (!Number.isFinite(n)) throw new Error('Invalid session ID for offline finalization');

      // 1) Récupérer les comptages locaux
      const counts = db.prepare(`
        SELECT produit_id, SUM(qty) AS counted_total
        FROM inventory_counts
        WHERE session_id = ?
        GROUP BY produit_id
      `).all(n);

      const countsMap = new Map(counts.map(c => [c.produit_id, Number(c.counted_total || 0)]));

      // 2) Pour chaque produit avec un comptage, calculer delta et créer stock_movement
      const produits = db.prepare(`SELECT id, stock, prix FROM produits`).all();
      const insertSummary = db.prepare(`
        INSERT OR REPLACE INTO inventory_summary (session_id, produit_id, stock_start, counted_total, delta, unit_cost, delta_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        for (const p of produits) {
          const stockStart = Number(p.stock || 0);
          const counted = countsMap.get(p.id) || 0;
          const delta = counted - stockStart;
          const unitCost = Number(p.prix || 0);
          const deltaValue = delta * unitCost;

          // Sauvegarder dans summary
          insertSummary.run(n, p.id, stockStart, counted, delta, unitCost, deltaValue);

          // Si delta non nul, créer mouvement + mettre à jour stock
          if (delta !== 0) {
            createStockMovement(p.id, delta, 'inventory', null, {
              session_id: n,
              stock_start: stockStart,
              counted_total: counted,
              delta: delta
            });
          }
        }

        // 3) Marquer session comme fermée
        db.prepare(`UPDATE inventory_sessions SET status='closed', ended_at=datetime('now','localtime') WHERE id = ?`).run(n);
      });
      tx();

      console.log('[inventory] Finalization offline complete - stocks updated locally');
    } catch (e) {
      console.error('[inventory] Offline finalization failed:', e?.message || e);
      throw e;
    }

    try {
      enqueueOp({ deviceId: DEFAULT_DEVICE_ID, opType: 'inventory.finalize', entityType: 'inventory_session', entityId: sessionId, payload: { session_id: sessionId, user } });
    } catch (e) { console.warn('[inventory] enqueue finalize failed', e?.message || e); }

    try {
      const payload = { sessionId: String(sessionId), closed: true, at: Date.now() };
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('inventory:session-closed', payload));
    } catch (_) {}

    return { ok: true, queued: true };
  });

  // Historique sessions enrichi avec statistiques
  safeHandle(ipcMain, 'inventory:listSessions', async () => {
    const items = await apiInventoryListSessions();
    
    // Enrichir chaque session avec ses statistiques (counted_lines, total_products, inventory_value)
    const enriched = await Promise.all(items.map(async (session) => {
      try {
        const sessionId = String(session.id || '').trim();
        if (!sessionId || sessionId.toLowerCase() === 'nan') {
          console.warn('[inventory] listSessions: session sans ID valide', session);
          return {
            ...session,
            counted_lines: 0,
            total_products: 0,
            inventory_value: 0
          };
        }
        
        const summary = await apiInventorySummary(sessionId);
        const lines = summary?.lines || [];
        const counted_lines = lines.filter(l => Number(l.counted_total || 0) > 0).length;
        const total_products = lines.length;
        const inventory_value = lines.reduce((acc, l) => {
          const qty = Number(l.counted_total || 0);
          const price = Number(l.price || 0);
          return acc + (qty * price);
        }, 0);
        
        return {
          ...session,
          counted_lines,
          total_products,
          inventory_value
        };
      } catch (e) {
        console.warn('[inventory] Erreur enrichissement session', session?.id, e?.message || e);
        return {
          ...session,
          counted_lines: 0,
          total_products: 0,
          inventory_value: 0
        };
      }
    }));
    
    return enriched;
  });

  safeHandle(ipcMain, 'inventory:getSummary', async (event, sessionId) => {
    console.log('[inventory] getSummary called with:', { sessionId, type: typeof sessionId });
    // sessionId should be a UUID string from listSessions
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new Error('inventory:getSummary BAD_ARG sessionId');
    }
    const sum = await apiInventorySummary(sessionId);
    return sum.raw;
  });

  // Récupérer comptages détaillés par device (multiposte)
  safeHandle(ipcMain, 'inventory:getCounts', async (_e, sessionId) => {
    try {
      const counts = await apiInventoryCounts(sessionId);
      return counts;
    } catch (e) {
      console.warn('[inventory] getCounts failed', e?.message || e);
      return [];
    }
  });

  // Récupérer sessions locales synchronisées (pour détection sessions distantes)
  safeHandle(ipcMain, 'inventory:getLocalSessions', async (_e, options = {}) => {
    try {
      const db = getDb();
      const { status = 'open', limit = 10 } = options;
      
      let query = `SELECT id, remote_uuid, name, status, started_at, ended_at 
                   FROM inventory_sessions`;
      const params = [];
      
      if (status && status !== 'all') {
        query += ` WHERE status = ?`;
        params.push(status);
      }
      
      query += ` ORDER BY started_at DESC LIMIT ?`;
      params.push(limit);
      
      const sessions = db.prepare(query).all(...params);
      return sessions || [];
    } catch (e) {
      console.warn('[inventory] getLocalSessions failed', e?.message || e);
      return [];
    }
  });

  // Supprimer une session locale (nettoyage base locale uniquement)
  safeHandle(ipcMain, 'inventory:deleteLocalSession', async (_e, localId) => {
    try {
      const db = getDb();
      const id = Number(localId);
      if (!Number.isFinite(id)) throw new Error('Invalid local session ID');
      
      // Supprimer les comptages associés
      db.prepare(`DELETE FROM inventory_counts WHERE session_id = ?`).run(id);
      
      // Supprimer le résumé si existe
      try {
        db.prepare(`DELETE FROM inventory_summary WHERE session_id = ?`).run(id);
      } catch {}
      
      // Supprimer la session
      db.prepare(`DELETE FROM inventory_sessions WHERE id = ?`).run(id);
      
      console.log('[inventory] Session locale supprimée:', id);
      return { ok: true, deleted: id };
    } catch (e) {
      console.error('[inventory] deleteLocalSession failed', e?.message || e);
      throw e;
    }
  });

  // ⚠️ Option C: Fermer toutes les sessions "open"
  safeHandle(ipcMain, 'inventory:closeAllOpen', async () => {
    const { token } = resolveAuthContext();
    const sessions = await apiInventoryListSessions();
    const openOnes = sessions.filter(s => statusOf(s.status || s.etat) === 'open');

    let closed = 0, errors = 0;
    for (const s of openOnes) {
      const id = s.id || s.session_id || s.uuid;
      if (!id) continue;
      try {
        const out = await apiInventoryFinalize(API, token, String(id), { user: 'admin' });
        closed++;
        try {
          BrowserWindow.getAllWindows().forEach(w =>
            w.webContents.send('inventory:session-closed', { sessionId: String(id), closed: true, at: Date.now() })
          );
        } catch {}
      } catch (e) {
        const msg = String(e?.message || e);
        if (/session_locked/.test(msg)) {
          // Déjà verrouillée côté API → considérer comme close
          closed++;
          try {
            BrowserWindow.getAllWindows().forEach(w =>
              w.webContents.send('inventory:session-closed', { sessionId: String(id), closed: true, at: Date.now() })
            );
          } catch {}
        } else {
          errors++;
          console.warn('[inventory] closeAllOpen error for', id, msg);
        }
      }
    }
    return { ok: true, closed, errors };
  });

  // Handler pour récupérer le device ID
  ipcMain.handle('get-device-id', async () => {
    return getDeviceId();
  });
};

// Exporter sendInventoryEmail comme propriété de la fonction
module.exports.sendInventoryEmail = sendInventoryEmail;
