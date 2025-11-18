// src/main/sync.js
'use strict';

const { BrowserWindow } = require('electron');
const db = require('./db/db');
const { apiFetch } = require('./apiClient');
const { getDeviceId } = require('./device');

// ID du device (stable pour ce poste)
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// helpers simples
const b2i = (v) => (v ? 1 : 0);

function notifyRenderer(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      w.webContents.send(channel, payload);
    } catch (_) {}
  });
}

/* petites aides pour le chip (badge sync dans l'UI) */
function setState(status, info = {}) {
  // status: 'online' | 'offline' | 'pushing' | 'pulling' | 'idle'
  notifyRenderer('sync:state', { status, ...info, ts: Date.now() });
}

/* ========== Utils schéma local ========== */
function tableCols(table) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    const set = new Set(rows.map((r) => r.name));
    return { set, rows };
  } catch {
    return { set: new Set(), rows: [] };
  }
}

function hasCol(table, col) {
  return tableCols(table).set.has(col);
}

function asIntOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

/* -------------------------------------------------
   PULL refs depuis Neon -> Sauvegarde locale
--------------------------------------------------*/
async function pullRefs({ since = null } = {}) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';

  setState('pulling');
  let res;
  try {
    res = await apiFetch(`/sync/pull_refs${qs}`, { method: 'GET' });
  } catch (e) {
    setState('offline', { error: String(e) });
    throw new Error(`pull_refs network ${String(e)}`);
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    setState('offline', { error: `HTTP ${res.status}` });
    throw new Error(`pull_refs ${res.status} ${t}`);
  }

  const json = await res.json();
  const d = json?.data || {};
  const {
    unites = [],
    familles = [],
    categories = [],
    adherents = [],
    fournisseurs = [],
    produits = [],
    modes_paiement = [],
  } = d;

  // --- préparations SQLite ---

  // UNITÉS
  const insUniteByName = db.prepare(`INSERT INTO unites(nom) VALUES (?)`);
  const selUniteIdByName = db.prepare(`SELECT id FROM unites WHERE nom = ?`);

  // FAMILLES
  const insFamByName = db.prepare(`INSERT INTO familles(nom) VALUES (?)`);
  const selFamIdByName = db.prepare(`SELECT id FROM familles WHERE nom = ?`);

  // CATÉGORIES
  const insCatByName = db.prepare(
    `INSERT INTO categories(nom, famille_id) VALUES (?, ?)`
  );
  const selCatIdByName = db.prepare(
    `SELECT id, famille_id FROM categories WHERE nom = ?`
  );
  const updCatFamily = db.prepare(
    `UPDATE categories SET famille_id = ? WHERE id = ?`
  );

  // ADHÉRENTS (on réécrit tout, pas besoin d'upsert compliqué)
  const insAdh = db.prepare(`
    INSERT INTO adherents
      (nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  // FOURNISSEURS
  const insFour = db.prepare(`
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const selFourIdByName = db.prepare(
    `SELECT id FROM fournisseurs WHERE LOWER(nom) = LOWER(?) LIMIT 1`
  );

  // MODES DE PAIEMENT
  const insMode = db.prepare(`
    INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
    VALUES (?,?,?,?)
  `);

  // PRODUITS : colonnes dynamiques
  const produitsHasUnite = hasCol('produits', 'unite_id');
  const produitsHasFournisseur = hasCol('produits', 'fournisseur_id');
  const produitsHasCategorie = hasCol('produits', 'categorie_id');
  const produitsHasRemote = hasCol('produits', 'remote_uuid');
  const produitsHasUpdatedAt = hasCol('produits', 'updated_at');

  const insProdBaseColumns = (() => {
    const cols = ['nom', 'reference', 'prix', 'stock', 'code_barre'];
    if (produitsHasUnite) cols.push('unite_id');
    if (produitsHasFournisseur) cols.push('fournisseur_id');
    if (produitsHasCategorie) cols.push('categorie_id');
    if (produitsHasRemote) cols.push('remote_uuid');
    if (produitsHasUpdatedAt) cols.push('updated_at');
    const placeholders = cols.map(() => '?').join(',');
    return { cols, placeholders };
  })();

  const insProd = db.prepare(`
    INSERT INTO produits (${insProdBaseColumns.cols.join(',')})
    VALUES (${insProdBaseColumns.placeholders})
  `);

  // Maps remote → local IDs
  const uniteUuidToLocalId = new Map();
  const famUuidToLocalId = new Map();
  const catUuidToLocalId = new Map();
  const fourUuidToLocalId = new Map();

  // === Transaction locale ===
  const tx = db.transaction(() => {
    // RESET des tables de référentiels pour le tenant courant
    db.prepare('DELETE FROM modes_paiement').run();
    db.prepare('DELETE FROM produits').run();
    db.prepare('DELETE FROM fournisseurs').run();
    db.prepare('DELETE FROM adherents').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM familles').run();
    db.prepare('DELETE FROM unites').run();

    // ----- UNITÉS -----
    for (const r of unites) {
      const name = (r.nom || '').trim();
      const remoteId = r.id ? String(r.id) : '';
      if (!name || !remoteId) continue;

      insUniteByName.run(name);
      const row = selUniteIdByName.get(name);
      if (row && row.id != null) {
        uniteUuidToLocalId.set(remoteId, row.id);
      }
    }

    // ----- FAMILLES -----
    for (const r of familles) {
      const name = (r.nom || '').trim();
      const remoteId = r.id ? String(r.id) : '';
      if (!name || !remoteId) continue;

      insFamByName.run(name);
      const row = selFamIdByName.get(name);
      if (row && row.id != null) {
        famUuidToLocalId.set(remoteId, row.id);
      }
    }

    // ----- CATÉGORIES -----
    for (const r of categories) {
      const name = (r.nom || '').trim();
      if (!name) continue;

      const remoteCatId = r.id ? String(r.id) : '';
      let localFamId = null;
      const remoteFamId = r.famille_id ? String(r.famille_id) : '';
      if (remoteFamId && famUuidToLocalId.has(remoteFamId)) {
        localFamId = famUuidToLocalId.get(remoteFamId);
      }

      insCatByName.run(name, localFamId);
      const existing = selCatIdByName.get(name);
      if (existing && existing.id != null) {
        const needMove =
          (existing.famille_id || null) !== (localFamId || null);
        if (needMove) updCatFamily.run(localFamId, existing.id);

        if (remoteCatId) {
          catUuidToLocalId.set(remoteCatId, existing.id);
        }
      }
    }

    // ----- ADHÉRENTS -----
    for (const r of adherents) {
      const email = (r.email1 || '').trim().toLowerCase() || null;

      const base = [
        r.nom || '',
        r.prenom || '',
        email,
        r.email2 || null,
        r.telephone1 || null,
        r.telephone2 || null,
        r.adresse || null,
        r.code_postal || null,
        r.ville || null,
        r.nb_personnes_foyer || null,
        r.tranche_age || null,
        Number(r.droit_entree ?? 0),
        r.date_inscription || null,
        b2i(r.archive),
        r.date_archivage || null,
        r.date_reactivation || null,
      ];

      insAdh.run(...base);
    }

    // ----- FOURNISSEURS -----
    for (const r of fournisseurs) {
      const nom = (r.nom || '').trim();
      if (!nom) continue;

      const remoteId = r.id ? String(r.id) : '';

      const base = [
        nom,
        r.contact || null,
        r.email || null,
        r.telephone || null,
        r.adresse || null,
        r.code_postal || null,
        r.ville || null,
        null, // categorie_id (mapping UUID -> local si on veut l'étendre plus tard)
        null, // referent_id (non géré côté Neon pour l'instant)
        r.label ?? null,
      ];

      insFour.run(...base);
      const row = selFourIdByName.get(nom);
      if (remoteId && row && row.id != null) {
        fourUuidToLocalId.set(remoteId, row.id);
      }
    }

    // ----- PRODUITS -----
    for (const r of produits) {
      const remoteProdId =
        r.id !== undefined && r.id !== null ? String(r.id) : null;

      // mappe les FKs si les colonnes existent côté SQLite
      let localUniteId = null;
      if (produitsHasUnite && r.unite_id) {
        const key = String(r.unite_id);
        if (uniteUuidToLocalId.has(key)) {
          localUniteId = uniteUuidToLocalId.get(key);
        }
      }

      let localFourId = null;
      if (produitsHasFournisseur && r.fournisseur_id) {
        const key = String(r.fournisseur_id);
        if (fourUuidToLocalId.has(key)) {
          localFourId = fourUuidToLocalId.get(key);
        }
      }

      let localCatId = null;
      if (produitsHasCategorie && r.categorie_id) {
        const key = String(r.categorie_id);
        if (catUuidToLocalId.has(key)) {
          localCatId = catUuidToLocalId.get(key);
        }
      }

      // construit la liste de valeurs dans le même ordre que les colonnes
      const values = [];
      for (const col of insProdBaseColumns.cols) {
        switch (col) {
          case 'nom':
            values.push(r.nom ?? null);
            break;
          case 'reference':
            values.push(r.reference ?? null);
            break;
          case 'prix':
            values.push(Number(r.prix ?? 0));
            break;
          case 'stock':
            values.push(Number(r.stock ?? 0));
            break;
          case 'code_barre':
            values.push(r.code_barre ?? null);
            break;
          case 'unite_id':
            values.push(localUniteId);
            break;
          case 'fournisseur_id':
            values.push(localFourId);
            break;
          case 'categorie_id':
            values.push(localCatId);
            break;
          case 'remote_uuid':
            values.push(remoteProdId);
            break;
          case 'updated_at':
            values.push(r.updated_at || null);
            break;
          default:
            values.push(null);
        }
      }

      try {
        insProd.run(...values);
      } catch (e) {
        console.error('[pullRefs] insert produit error:', e, 'row=', r);
      }
    }

    // ----- MODES DE PAIEMENT -----
    for (const m of modes_paiement) {
      const nom = (m.nom || '').trim();
      if (!nom) continue;

      const taux = Number(m.taux_percent ?? 0);
      const frais = Number(m.frais_fixe ?? 0);
      const actif = b2i(!!m.actif);

      try {
        insMode.run(nom, taux, frais, actif);
      } catch (e) {
        console.error('[pullRefs] insert mode_paiement error:', e, 'row=', m);
      }
    }
  }); // fin transaction

  // Couper / réactiver les FK autour de la transaction
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    tx();
  } catch (e) {
    console.error('[pullRefs] TX error:', e);
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  notifyRenderer('data:refreshed', { from: 'pull_refs' });
  setState('online', { phase: 'pulled' });

  return {
    ok: true,
    counts: {
      unites: unites.length,
      familles: familles.length,
      categories: categories.length,
      adherents: adherents.length,
      fournisseurs: fournisseurs.length,
      produits: produits.length,
      modes_paiement: modes_paiement.length,
    },
  };
}

/* -------------------------------------------------
   OPS queue → push vers Neon
--------------------------------------------------*/
function takePendingOps(limit = 1000) {
  return db
    .prepare(
      `
    SELECT id, device_id, op_type, entity_type, entity_id, payload_json
    FROM ops_queue WHERE ack = 0 ORDER BY created_at ASC LIMIT ?
  `
    )
    .all(limit);
}

function countPendingOps() {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`)
    .get();
  return r?.n || 0;
}

/**
 * Pousse immédiatement les opérations en file.
 * - deviceId: identifiant de ce poste (par défaut = DEVICE_ID)
 * - options.skipPull: si true, n'appelle PAS pullRefs() après le push
 */
async function pushOpsNow(deviceId = DEVICE_ID, options = {}) {
  const { skipPull = false } = options || {};

  const ops = takePendingOps(200);
  if (ops.length === 0) {
    setState('online', { phase: 'idle', pending: 0 });
    return { ok: true, sent: 0, pending: 0 };
  }

  setState('pushing', { pending: ops.length });

  const payload = {
    deviceId,
    ops: ops.map((o) => ({
      id: o.id,
      op_type: o.op_type,
      entity_type: o.entity_type,
      // ⚠️ IMPORTANT : on n’envoie un entity_id que si c’est un vrai UUID
      entity_id: isUuid(o.entity_id) ? o.entity_id : null,
      payload_json: o.payload_json,
    })),
  };

  let res;
  try {
    res = await apiFetch('/sync/push_ops', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    setState('offline', { error: String(e), pending: countPendingOps() });
    return { ok: false, error: String(e), pending: countPendingOps() };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    setState('offline', {
      error: `HTTP ${res.status}`,
      pending: countPendingOps(),
    });
    return {
      ok: false,
      error: `HTTP ${res.status} ${txt}`,
      pending: countPendingOps(),
    };
  }

  const ids = ops.map((o) => o.id);
  db.prepare(
    `UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE id IN (${ids
      .map(() => '?')
      .join(',')})`
  ).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });

  // Pull refs après push, sauf si on est dans un cas spécial (startup push-before-pull)
  if (!skipPull) {
    try {
      await pullRefs();
    } catch (e) {
      setState('online', { phase: 'pull_failed', error: String(e) });
    }
  }

  const left = countPendingOps();
  setState('online', { phase: 'idle', pending: left });
  return { ok: true, sent: ids.length, pending: left };
}

/**
 * 🔁 Background sync déclenché après une action (création / modif / vente, etc.)
 * On l’exporte pour que les DB puissent l’appeler.
 */
let _bgSyncInFlight = false;
function triggerBackgroundSync(deviceId = DEVICE_ID) {
  if (_bgSyncInFlight) return;
  _bgSyncInFlight = true;

  setImmediate(async () => {
    try {
      await pushOpsNow(deviceId);
    } catch (_) {
      // on ne casse jamais l’UI sur une erreur réseau ici
    } finally {
      _bgSyncInFlight = false;
    }
  });
}

/* -------------------------------------------------
   BOOTSTRAP / HYDRATE
--------------------------------------------------*/
function collectLocalRefs() {
  const exists = (table, id) => {
    const n = asIntOrNull(id);
    if (n == null) return false;
    try {
      const r = db
        .prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`)
        .get(n);
      return !!r;
    } catch {
      return false;
    }
  };

  const all = (sql) => db.prepare(sql).all();

  const unites = all(`SELECT id, nom FROM unites ORDER BY id`);
  const familles = all(`SELECT id, nom FROM familles ORDER BY id`);
  const categories = all(
    `SELECT id, nom, famille_id FROM categories ORDER BY id`
  );
  const adherents = all(`
    SELECT id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
           nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation
    FROM adherents ORDER BY id
  `);
  const fournisseurs = all(`
    SELECT id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label
    FROM fournisseurs ORDER BY id
  `).map((f) => ({
    ...f,
    categorie_id: exists('categories', f.categorie_id) ? f.categorie_id : null,
    referent_id: exists('adherents', f.referent_id) ? f.referent_id : null,
  }));

  const produits = all(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `).map((p) => ({
    ...p,
    unite_id: exists('unites', p.unite_id) ? p.unite_id : null,
    fournisseur_id: exists('fournisseurs', p.fournisseur_id)
      ? p.fournisseur_id
      : null,
    categorie_id: exists('categories', p.categorie_id) ? p.categorie_id : null,
  }));

  const modes_paiement = all(
    `SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`
  );

  return {
    unites,
    familles,
    categories,
    adherents,
    fournisseurs,
    produits,
    modes_paiement,
  };
}

// ⚠️ On garde bootstrapIfNeeded pour un usage manuel/exceptionnel,
// mais on NE L’APPELLE PLUS automatiquement au démarrage.
async function bootstrapIfNeeded() {
  let needed = false;
  try {
    const r = await apiFetch('/sync/bootstrap_needed', { method: 'GET' });
    if (r.ok) {
      const j = await r.json();
      needed = !!j?.needed;
    } else {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `bootstrap_needed HTTP ${r.status} ${t}` };
    }
  } catch (e) {
    setState('offline', { error: String(e) });
    return { ok: false, error: String(e) };
  }

  if (!needed) return { ok: true, bootstrapped: false };

  const refs = collectLocalRefs();
  let resp;
  try {
    resp = await apiFetch('/sync/bootstrap', {
      method: 'POST',
      body: JSON.stringify(refs),
    });
  } catch (e) {
    setState('offline', { error: String(e) });
    return { ok: false, error: String(e) };
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    setState('offline', { error: `HTTP ${resp.status}` });
    return { ok: false, error: `HTTP ${resp.status} ${txt}` };
  }

  const js = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: js?.counts || {} });

  try {
    await pullRefs();
  } catch (_) {}

  return { ok: true, bootstrapped: true, counts: js?.counts || {} };
}

// 🆕 Version simple : au démarrage, on fait juste un pull
// (le bootstrap automatique est géré ailleurs ou manuellement)
async function hydrateOnStartup() {
  setState('pulling', { phase: 'startup' });
  const r = await pullRefs();
  setState('online', { phase: 'startup_done' });
  return r;
}

async function pullAll() {
  return pullRefs();
}

/* -------------------------------------------------
   Auto sync périodique
--------------------------------------------------*/
let _autoTimer = null;
let _intervalMs = 30000; // 30s

function stopAutoSync() {
  if (_autoTimer) {
    clearTimeout(_autoTimer);
    _autoTimer = null;
  }
}

function startAutoSync(deviceId = DEVICE_ID) {
  if (_autoTimer) return;
  const loop = async () => {
    try {
      await pushOpsNow(deviceId);
      _intervalMs = 30000;
    } catch (e) {
      _intervalMs = Math.min(_intervalMs + 15000, 120000);
    } finally {
      _autoTimer = setTimeout(loop, _intervalMs);
    }
  };
  _autoTimer = setTimeout(loop, 1000);
}

/* -------------------------------------------------
   Export public
--------------------------------------------------*/
async function pushBootstrapRefs() {
  const refs = collectLocalRefs();
  const resp = await apiFetch('/sync/bootstrap', {
    method: 'POST',
    body: JSON.stringify(refs),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`bootstrap HTTP ${resp.status} ${txt}`);
  }
  const js = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: js?.counts || {} });
  await pullRefs();
  return { ok: true, counts: js?.counts || {} };
}

// Remplace l’ancienne version de syncPushAll par celle-ci
async function syncPushAll(deviceId = DEVICE_ID) {
  try {
    // 1) push des opérations en attente
    const pushRes = await pushOpsNow(deviceId);

    // 2) puis pull complet pour rafraîchir les refs
    let pullRes = null;
    try {
      pullRes = await pullRefs();
    } catch (e) {
      setState('online', {
        phase: 'pull_failed_after_push_all',
        error: String(e),
      });
    }

    setState('online', { phase: 'idle', pending: countPendingOps() });
    return {
      ok: true,
      push: pushRes,
      pull: pullRes,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  hydrateOnStartup,
  pullRefs,
  pullAll,
  pushOpsNow,
  startAutoSync,
  stopAutoSync,
  countPendingOps,
  pushBootstrapRefs,
  syncPushAll,
  triggerBackgroundSync,   // 👈 IMPORTANT pour les DB métiers
};
