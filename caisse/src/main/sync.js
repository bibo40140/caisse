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
   PULL refs depuis Neon -> (pour l’instant) lecture seule

   ⚠️ Version "safe" : on ne MODIFIE PAS la base locale.
   - On interroge Neon
   - On met à jour l’état de sync + on renvoie juste les counts
   - AUCUN DELETE / INSERT / UPDATE dans SQLite ici.

   ➜ La vérité reste 100% locale pour :
     - unites / familles / categories
     - adherents
     - fournisseurs / produits
     - modes_paiement

   ➜ Neon reçoit les données via push_ops (création d’adhérents,
     fournisseurs, produits, ventes, réceptions...). On ajoutera
     plus tard un vrai pull "fine-grain" quand tout sera figé.
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

  // 🔸 IMPORTANT :
  // Pour cette version stable, on ne touche PAS à la base locale ici.
  // On se contente de signaler à l’UI qu’un pull a eu lieu.

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

  const normalizeOpId = (raw) => {
    const s = (raw ?? '').toString().trim();
    if (isUuid(s)) return s;

    const n = Number(s);
    const hex = Number.isFinite(n) ? n.toString(16) : '0';
    const suffix = hex.padStart(12, '0').slice(-12);
    return `00000000-0000-0000-0000-${suffix}`;
  };

  const idsForOps = ops.map((o) => o.id);
  const payload = {
    deviceId,
    ops: ops.map((o) => ({
      id: normalizeOpId(o.id),
      op_type: o.op_type,
      entity_type: o.entity_type,
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
    const err = String(e);
    try {
      const upd = db.prepare(
        `UPDATE ops_queue SET retry_count = COALESCE(retry_count,0) + 1, last_error = ?, failed_at = datetime('now','localtime') WHERE id IN (${idsForOps.map(() => '?').join(',')})`
      );
      upd.run(err, ...idsForOps);
    } catch (ee) {
      console.warn('[sync] failed to mark ops retry:', ee?.message || ee);
    }
    setState('offline', { error: err, pending: countPendingOps() });
    return { ok: false, error: err, pending: countPendingOps() };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = `HTTP ${res.status} ${txt}`;
    try {
      const upd2 = db.prepare(
        `UPDATE ops_queue SET retry_count = COALESCE(retry_count,0) + 1, last_error = ?, failed_at = datetime('now','localtime') WHERE id IN (${idsForOps.map(() => '?').join(',')})`
      );
      upd2.run(err, ...idsForOps);
    } catch (ee) {
      console.warn('[sync] failed to mark ops retry after HTTP error:', ee?.message || ee);
    }
    setState('offline', {
      error: `HTTP ${res.status}`,
      pending: countPendingOps(),
    });
    return {
      ok: false,
      error: err,
      pending: countPendingOps(),
    };
  }

  // 🧠 Nouveau : tenter de lire le JSON de réponse pour récupérer les mappings
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  // Si le serveur renvoie des mappings produits, on met à jour produits.remote_uuid en local
  try {
    if (body && body.mappings && Array.isArray(body.mappings.produits)) {
      const stmt = db.prepare(
        `UPDATE produits
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );

      for (const m of body.mappings.produits) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;

        try {
          stmt.run(remoteUuid, localId);
          console.log('[sync] remote_uuid mis à jour en local', {
            localId,
            remoteUuid,
          });
        } catch (e) {
          console.warn('[sync] erreur UPDATE produits.remote_uuid:', e?.message || e);
        }
      }
    }
    // Si le serveur renvoie des mappings pour inventory_sessions, on met à jour inventory_sessions.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.inventory_sessions)) {
      const stmtSess = db.prepare(
        `UPDATE inventory_sessions
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.inventory_sessions) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtSess.run(remoteUuid, localId);
          console.log('[sync] inventory_sessions.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE inventory_sessions.remote_uuid:', e?.message || e);
        }
      }
    }
    
    // 🔥 Si le serveur renvoie des mappings pour ventes, on met à jour ventes.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.ventes)) {
      const stmtVente = db.prepare(
        `UPDATE ventes
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.ventes) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtVente.run(remoteUuid, localId);
          console.log('[sync] ventes.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE ventes.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour receptions, on met à jour receptions.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.receptions)) {
      const stmtReception = db.prepare(
        `UPDATE receptions
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.receptions) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtReception.run(remoteUuid, localId);
          console.log('[sync] receptions.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE receptions.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour fournisseurs, on met à jour fournisseurs.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.fournisseurs)) {
      const stmtFournisseur = db.prepare(
        `UPDATE fournisseurs
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.fournisseurs) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtFournisseur.run(remoteUuid, localId);
          console.log('[sync] fournisseurs.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE fournisseurs.remote_uuid:', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[sync] traitement des mappings échoué:', e?.message || e);
  }

  const ids = ops.map((o) => o.id);
  db.prepare(
    `UPDATE ops_queue
      SET ack = 1,
        sent_at = datetime('now','localtime'),
        retry_count = 0,
        last_error = NULL,
        failed_at = NULL
      WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });

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

// Auto sync loop control
let _autoSyncTimer = null;
let _autoSyncIntervalMs = 5000; // valeur de base

function jitter(ms) {
  // jitter +/- 20%
  const frac = 0.2;
  const delta = Math.floor(ms * frac);
  return ms - delta + Math.floor(Math.random() * (delta * 2 + 1));
}

/**
 * Démarre l'auto-sync qui adapte l'intervalle selon l'échec des ops.
 * Backoff exponentiel basé sur le retry_count maximum présent dans la file.
 */
function startAutoSync(deviceId = DEVICE_ID) {
  // clear existing timer
  if (_autoSyncTimer) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = null;
  }

  const MAX_RETRY_ATTEMPTS = 5;
  const BASE_INTERVAL_MS = 5000; // 5s
  const MAX_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  async function runOnce() {
    try {
      // Count pending
      const pending = countPendingOps();
      if (pending === 0) {
        setState('online', { phase: 'idle', pending: 0 });
        // schedule next check at base interval
        _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
        return;
      }

      // get max retry_count among pending ops
      let maxRetry = 0;
      try {
        const row = db.prepare('SELECT MAX(COALESCE(retry_count,0)) AS m FROM ops_queue WHERE ack = 0').get();
        maxRetry = row?.m || 0;
      } catch (e) {
        maxRetry = 0;
      }

      if (maxRetry >= MAX_RETRY_ATTEMPTS) {
        // Too many retries — don't auto-retry these ops, notify UI and sleep longer
        const row = db.prepare('SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0 AND COALESCE(retry_count,0) >= ?').get(MAX_RETRY_ATTEMPTS);
        const countBlocked = row?.n || 0;
        notifyRenderer('sync:failed_limit', { count: countBlocked });
        // schedule next check after a longer interval
        _autoSyncTimer = setTimeout(runOnce, MAX_INTERVAL_MS);
        return;
      }

      // compute backoff delay based on maxRetry
      const delay = Math.min(MAX_INTERVAL_MS, BASE_INTERVAL_MS * Math.pow(2, Math.max(0, maxRetry)));
      const delayWithJitter = jitter(delay);

      // If retry_count is zero we can push immediately, otherwise wait the backoff
      if (maxRetry === 0) {
        // try push now
        await pushOpsNow(deviceId).catch(() => {});
        _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
      } else {
        // schedule next push after computed backoff
        _autoSyncTimer = setTimeout(async () => {
          try {
            await pushOpsNow(deviceId).catch(() => {});
          } finally {
            // schedule next run after base interval
            _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
          }
        }, delayWithJitter);
      }
    } catch (e) {
      console.warn('[sync] startAutoSync error:', e?.message || e);
      _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
    }
  }

  // kick
  runOnce();
}

function stopAutoSync() {
  if (_autoSyncTimer) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = null;
  }
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

/* Auto-sync handled by startAutoSync/stopAutoSync (custom backoff/jitter).
   Functions `startAutoSync` and `stopAutoSync` are defined earlier in the file
   to provide exponential backoff with jitter based on per-op retry_count. */

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
  triggerBackgroundSync,   // 👈 on l’exporte
};
