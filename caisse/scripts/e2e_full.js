#!/usr/bin/env node
/* eslint-disable no-console */
// E2E complet: local (SQLite) <-> serveur (Neon via API)

const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const Database = require('better-sqlite3');

function arg(name, def = undefined) {
  const idx = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return def;
  const a = process.argv[idx];
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return process.argv[idx + 1] ?? def;
}

const API_BASE = arg('api', 'http://localhost:3001');
const SQLITE_PATH = (() => {
  const userPath = arg('sqlite', null);
  if (userPath) return userPath;
  const candidates = [
    './coopaz.db',
    './data/coopaz.db',
    path.join(__dirname, '..', 'data', 'coopaz.db'),
    path.join(__dirname, '..', 'src', 'main', 'db', 'coopaz.db'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return './coopaz.db';
})();
const PRODUCT_ID_CLI = arg('productId', null) != null ? Number(arg('productId')) : null;
const QTY = Number(arg('qty', 3));

console.log('API_BASE =', API_BASE);
console.log('SQLITE   =', SQLITE_PATH);
console.log('QTY      =', QTY);

function exitErr(msg, extra) {
  console.error(`\n❌ E2E ÉCHEC: ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}

async function httpJSON(url, opt = {}) {
  const res = await fetch(url, opt);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

function openDb(p) {
  try { return new Database(p); }
  catch (e) { exitErr(`Impossible d'ouvrir SQLite: ${p}`, e.message); }
}

// --- helpers sqlite
function tableHasColumn(db, table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === column);
  } catch {
    return false;
  }
}
function ensureTables(db) {
  const need = ['produits','receptions','lignes_reception','ventes','lignes_vente','stock_movements','ops_queue'];
  for (const t of need) {
    try { db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(); }
    catch (e) { exitErr(`Table manquante en local: ${t}`, e.message); }
  }
}
function uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function localCurrentStock(db, productId) {
  const row = db.prepare(`
    SELECT
      COALESCE( (SELECT SUM(delta) FROM stock_movements WHERE produit_id = ?), 0 ) AS delta,
      COALESCE( (SELECT stock FROM produits WHERE id = ?), 0 ) AS base
  `).get(productId, productId);
  return Number(row.base) + Number(row.delta);
}

async function main() {
  // 0) Health
  console.log('\n═══ HEALTH ═══');
  const h1 = await httpJSON(`${API_BASE}/health`);
  console.log('GET /health ->', h1.body);
  if (!h1.ok) exitErr('API /health KO');
  const h2 = await httpJSON(`${API_BASE}/health/db`);
  console.log('GET /health/db ->', h2.body);
  if (!h2.ok) exitErr('API /health/db KO');

  // 1) Ouvre SQLite
  const db = openDb(SQLITE_PATH);
  ensureTables(db);

  // 1.bis) Détecte colonnes (robuste)
  const ventesHasCreatedAt = tableHasColumn(db, 'ventes', 'created_at');
  const lignesVenteHasCreatedAt = tableHasColumn(db, 'lignes_vente', 'created_at');

  // 2) Choix produit
  let productId = PRODUCT_ID_CLI;
  if (!Number.isFinite(productId)) {
    const row = db.prepare(`SELECT id, nom FROM produits ORDER BY id LIMIT 1`).get();
    if (!row) exitErr('Aucun produit en base locale.');
    productId = Number(row.id);
    console.log(`Produit choisi (auto): id=${row.id}, nom="${row.nom}"`);
  } else {
    const chk = db.prepare(`SELECT id, nom FROM produits WHERE id=?`).get(productId);
    if (!chk) exitErr(`Produit ${productId} introuvable en local`);
    console.log(`Produit choisi (CLI): id=${chk.id}, nom="${chk.nom}"`);
  }

  // 3) Snapshots init
  console.log('\n═══ SNAPSHOT INITIAL ═══');
  const localStart = localCurrentStock(db, productId);
  console.log('Stock local initial =', localStart);

  const pull1 = await httpJSON(`${API_BASE}/sync/pull_refs`);
  if (!pull1.ok || !pull1.body?.ok) exitErr('pull_refs initial KO', pull1);
  const prodSrv = (pull1.body.data?.produits || []).find(p => Number(p.id) === productId);
  if (!prodSrv) exitErr(`Produit ${productId} introuvable côté serveur via pull_refs`);
  const serverStart = Number(prodSrv.stock ?? 0);
  console.log('Stock serveur initial =', serverStart);

  // 4) Écritures locales + ops
  console.log('\n═══ LOCAL: RÉCEPTION + VENTE + AJUSTEMENT ═══');

  const receptionRef = `TESTREC-${Date.now()}`;
  const deviceId = uuid4();

  const tx = db.transaction(() => {
    // Réception
    const rec = db.prepare(`
      INSERT INTO receptions (fournisseur_id, date, reference, updated_at)
      VALUES (?, datetime('now','localtime'), ?, datetime('now','localtime'))
    `).run(1, receptionRef);
    const recId = rec.lastInsertRowid;

    db.prepare(`
      INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire, updated_at)
      VALUES (?,?,?,?, datetime('now','localtime'))
    `).run(recId, productId, QTY, null);

    // Mouvement +QTY
    const smId1 = uuid4();
    db.prepare(`
      INSERT INTO stock_movements (id, produit_id, delta, reason, ref_type, ref_id, note, device_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(smId1, productId, +QTY, 'reception', 'reception', String(recId), null, deviceId);

    // OPS réception
    const op1 = uuid4();
    db.prepare(`
      INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, created_at, ack)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'), 0)
    `).run(
      op1, deviceId, 'reception.line_added', 'reception', String(recId),
      JSON.stringify({
        receptionId: recId,
        fournisseurId: 1,
        reference: receptionRef,
        produitId: productId,
        quantite: QTY,
        prixUnitaire: null
      })
    );

    // Vente (insert conditionnel sur created_at)
    let vId;
    if (ventesHasCreatedAt) {
      const v = db.prepare(`
        INSERT INTO ventes (total, adherent_id, mode_paiement_id, sale_type, client_email, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
      `).run(0, null, null, 'adherent', null);
      vId = v.lastInsertRowid;
    } else {
      const v = db.prepare(`
        INSERT INTO ventes (total, adherent_id, mode_paiement_id, sale_type, client_email)
        VALUES (?, ?, ?, ?, ?)
      `).run(0, null, null, 'adherent', null);
      vId = v.lastInsertRowid;
    }

    // Ligne vente (conditionnel created_at)
    if (lignesVenteHasCreatedAt) {
      db.prepare(`
        INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent, created_at)
        VALUES (?,?,?,?,?,?, datetime('now','localtime'))
      `).run(vId, productId, QTY, 0, 0, 0);
    } else {
      db.prepare(`
        INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
        VALUES (?,?,?,?,?,?)
      `).run(vId, productId, QTY, 0, 0, 0);
    }

    // Mouvement -QTY
    const smId2 = uuid4();
    db.prepare(`
      INSERT INTO stock_movements (id, produit_id, delta, reason, ref_type, ref_id, note, device_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(smId2, productId, -QTY, 'sale', 'vente', String(vId), null, deviceId);

    // OPS vente
    const op2 = uuid4();
    db.prepare(`
      INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, created_at, ack)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'), 0)
    `).run(
      op2, deviceId, 'sale.created', 'vente', String(vId),
      JSON.stringify({
        venteId: vId,
        total: 0,
        adherentId: null,
        modePaiementId: null,
        saleType: 'adherent',
        clientEmail: null
      })
    );

    const op3 = uuid4();
    db.prepare(`
      INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, created_at, ack)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'), 0)
    `).run(
      op3, deviceId, 'sale.line_added', 'vente', String(vId),
      JSON.stringify({
        venteId: vId,
        produitId: productId,
        quantite: QTY,
        prix: 0,
        prixUnitaire: 0,
        remisePercent: 0
      })
    );

    // Ajustement inventaire local: +1
    const smId3 = uuid4();
    db.prepare(`
      INSERT INTO stock_movements (id, produit_id, delta, reason, ref_type, ref_id, note, device_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(smId3, productId, +1, 'inventory', 'inventory_adjust', `test:${Date.now()}`, null, deviceId);

    const op4 = uuid4();
    db.prepare(`
      INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, created_at, ack)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'), 0)
    `).run(
      op4, deviceId, 'inventory.adjust', 'produit', String(productId),
      JSON.stringify({ produitId: productId, delta: +1 })
    );
  });
  tx();

  // Vérifs locales minimales
  const lrCount = db.prepare(`SELECT COUNT(*) AS n FROM lignes_reception WHERE produit_id = ? AND quantite = ?`).get(productId, QTY).n;
  if (lrCount === 0) exitErr('Pas de ligne de réception locale trouvée.');
  const lvCount = db.prepare(`SELECT COUNT(*) AS n FROM lignes_vente WHERE produit_id = ? AND quantite = ?`).get(productId, QTY).n;
  if (lvCount === 0) exitErr('Pas de ligne de vente locale trouvée.');
  const smCount = db.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE produit_id = ?`).get(productId).n;
  if (smCount === 0) exitErr('Aucun mouvement de stock local enregistré.');

  const localAfterLocalOps = localCurrentStock(db, productId);
  console.log('Stock local après écritures locales =', localAfterLocalOps,
    `(delta local appliqué = ${localAfterLocalOps - localStart})`);

  // 5) PUSH ops → serveur
  console.log('\n═══ PUSH OPS → SERVEUR ═══');
  const pending = db.prepare(`SELECT id, device_id, op_type, entity_type, entity_id, payload_json
                              FROM ops_queue WHERE ack = 0 ORDER BY created_at ASC LIMIT 1000`).all();
  if (pending.length === 0) exitErr('Aucune op en attente dans ops_queue');

  const payload = {
    deviceId: pending[0].device_id,
    ops: pending.map(o => ({
      id: o.id,
      op_type: o.op_type,
      entity_type: o.entity_type,
      entity_id: o.entity_id,
      payload_json: o.payload_json
    }))
  };
  const push = await httpJSON(`${API_BASE}/sync/push_ops`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('POST /sync/push_ops ->', push.body);
  if (!push.ok || !push.body?.ok) exitErr('push_ops KO', push);

  db.prepare(`UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE ack = 0`).run();

  // 6) PULL refs (serveur → local)
  console.log('\n═══ PULL REFS ═══');
  const pull2 = await httpJSON(`${API_BASE}/sync/pull_refs`);
  if (!pull2.ok || !pull2.body?.ok) exitErr('pull_refs post-push KO', pull2);

  const srvProd2 = (pull2.body.data?.produits || []).find(p => Number(p.id) === productId);
  if (!srvProd2) exitErr('Produit introuvable dans pull_refs post-push');
  const serverEnd = Number(srvProd2.stock ?? 0);
  const localEnd = localCurrentStock(db, productId);

  // 7) Attendu: +QTY (reception) -QTY (sale) +1 (adjust) = +1
  const expectedServer = serverStart + 1;
  console.log(`Stock serveur attendu = ${expectedServer} | Stock serveur lu = ${serverEnd}`);
  if (serverEnd !== expectedServer) exitErr('Mismatch stock serveur', { expectedServer, serverEnd });

  console.log(`Stock local final   = ${localEnd} | (devrait être proche du serveur si base locale cohérente)`);
  if (localEnd !== localStart + 1) {
    console.warn('⚠ Alerte: stock local ne reflète pas +1 net. Vérifie stock_movements & base produits.stock');
  }

  console.log('\n✅ TEST E2E TERMINÉ SANS ERREUR');
}

main().catch(e => exitErr('exception', e?.stack || e?.message || String(e)));
