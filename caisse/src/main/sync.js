// src/main/sync.js
'use strict';

const { BrowserWindow } = require('electron');
const db = require('./db/db');
const { apiFetch } = require('./apiClient');

// helpers
const b2i = (v) => (v ? 1 : 0);

function notifyRenderer(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send(channel, payload); } catch (_) {}
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
    const set = new Set(rows.map(r => r.name));
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

/* -------------------------------------------------
   PULL refs depuis Neon -> Sauvegarde locale
   (correspondance par code_barre puis reference)
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

  /* ---- Upserts par NOM (les IDs API sont des UUID, le local est INTEGER) ---- */
  // Unités
  const insUniteByName = db.prepare(`
    INSERT OR IGNORE INTO unites(nom) VALUES (?)
  `);
  const selUniteIdByName = db.prepare(`SELECT id FROM unites WHERE nom = ?`);

  // Familles
  const insFamByName = db.prepare(`
    INSERT OR IGNORE INTO familles(nom) VALUES (?)
  `);
  const selFamIdByName = db.prepare(`SELECT id FROM familles WHERE nom = ?`);

  // Catégories
  const insCatByName = db.prepare(`
    INSERT OR IGNORE INTO categories(nom, famille_id) VALUES (?, ?)
  `);
  const selCatIdByName = db.prepare(`SELECT id, famille_id FROM categories WHERE nom = ?`);
  const updCatFamily = db.prepare(`UPDATE categories SET famille_id = ? WHERE id = ?`);
  
  const upAdh = db.prepare(`
    INSERT INTO adherents
      (id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, prenom=excluded.prenom, email1=excluded.email1, email2=excluded.email2,
      telephone1=excluded.telephone1, telephone2=excluded.telephone2, adresse=excluded.adresse,
      code_postal=excluded.code_postal, ville=excluded.ville, nb_personnes_foyer=excluded.nb_personnes_foyer,
      tranche_age=excluded.tranche_age, droit_entree=excluded.droit_entree, date_inscription=excluded.date_inscription,
      archive=excluded.archive, date_archivage=excluded.date_archivage, date_reactivation=excluded.date_reactivation
  `);
  const upFour = db.prepare(`
    INSERT INTO fournisseurs
      (id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, contact=excluded.contact, email=excluded.email, telephone=excluded.telephone,
      adresse=excluded.adresse, code_postal=excluded.code_postal, ville=excluded.ville,
      categorie_id=excluded.categorie_id, referent_id=excluded.referent_id, label=excluded.label
  `);
  const upMode = db.prepare(`
    INSERT INTO modes_paiement (id, nom, taux_percent, frais_fixe, actif)
    VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, taux_percent=excluded.taux_percent, frais_fixe=excluded.frais_fixe, actif=excluded.actif
  `);

  /* ---- Produits : correspondance par code_barre / reference + remote_uuid ---- */
  const produitsHasRemote = hasCol('produits', 'remote_uuid');
  const produitsHasUpdatedAt = hasCol('produits', 'updated_at');

  // requêtes utilitaires
  const selProdByBarcode = db.prepare(`SELECT id FROM produits WHERE REPLACE(COALESCE(code_barre,''),' ','') = REPLACE(COALESCE(?,''),' ','') LIMIT 1`);
  const selProdByReference = db.prepare(`SELECT id FROM produits WHERE reference = ? LIMIT 1`);
  const updProdCore = db.prepare(`
    UPDATE produits
       SET nom = COALESCE(?, nom),
           reference = COALESCE(?, reference),
           prix = COALESCE(?, prix),
           stock = COALESCE(?, stock),
           code_barre = COALESCE(?, code_barre)
     WHERE id = ?
  `);
  const updProdRemoteUuid = produitsHasRemote
    ? db.prepare(`UPDATE produits SET remote_uuid = ? WHERE id = ?`)
    : null;
  const updProdUpdatedAt = produitsHasUpdatedAt
    ? db.prepare(`UPDATE produits SET updated_at = ? WHERE id = ?`)
    : null;

  const insProdBaseColumns = (() => {
    const cols = ['nom','reference','prix','stock','code_barre'];
    if (produitsHasRemote) cols.push('remote_uuid');
    if (produitsHasUpdatedAt) cols.push('updated_at');
    const placeholders = cols.map(() => '?').join(',');
    return { cols, placeholders };
  })();

  const insProd = db.prepare(`
    INSERT INTO produits (${insProdBaseColumns.cols.join(',')})
    VALUES (${insProdBaseColumns.placeholders})
  `);

  const tx = db.transaction(() => {
    // 1) Unités (par nom)
    for (const r of unites) {
      const name = (r.nom || '').trim();
      if (!name) continue;
      insUniteByName.run(name);
    }

    // 2) Familles (par nom) + map remoteUUID -> localId
    const famUuidToLocalId = new Map();
    for (const r of familles) {
      const name = (r.nom || '').trim();
      const remoteId = String(r.id || '');
      if (!name || !remoteId) continue;
      insFamByName.run(name);
      const row = selFamIdByName.get(name);
      if (row && row.id != null) famUuidToLocalId.set(remoteId, row.id);
    }

    // 3) Catégories : on résout la famille locale via la map des UUID
    for (const r of categories) {
      const name = (r.nom || '').trim();
      if (!name) continue;

      let localFamId = null;
      const remoteFamId = r.famille_id ? String(r.famille_id) : '';
      if (remoteFamId && famUuidToLocalId.has(remoteFamId)) {
        localFamId = famUuidToLocalId.get(remoteFamId);
      }

      // INSERT OR IGNORE par nom
      insCatByName.run(name, localFamId);

      // Puis s’assurer que la famille est bien celle attendue (déplacement éventuel)
      const existing = selCatIdByName.get(name);
      if (existing && existing.id != null) {
        const needMove = (existing.famille_id || null) !== (localFamId || null);
        if (needMove) {
          updCatFamily.run(localFamId, existing.id);
        }
      }
    }

    // 4) Adhérents (ton code existant)
    for (const r of adherents) {
      const id = asIntOrNull(r.id);
      if (id == null) continue;
      upAdh.run(
        id, r.nom, r.prenom, r.email1, r.email2, r.telephone1, r.telephone2, r.adresse,
        r.code_postal, r.ville, r.nb_personnes_foyer, r.tranche_age, Number(r.droit_entree ?? 0),
        r.date_inscription, b2i(r.archive), r.date_archivage, r.date_reactivation
      );
    }

    // 5) Fournisseurs (ton code existant)
    for (const r of fournisseurs) {
      const id = asIntOrNull(r.id);
      if (id == null) continue;
      upFour.run(
        id, r.nom, r.contact, r.email, r.telephone, r.adresse, r.code_postal, r.ville,
        asIntOrNull(r.categorie_id), asIntOrNull(r.referent_id), r.label ?? null
      );
    }

    // 6) Produits (ton code existant, basé sur code_barre / reference)
    for (const r of produits) {
      const remoteUUID = r.id || null;
      const codeBarre  = r.code_barre || null;
      const reference  = r.reference || null;

      let localId = null;
      if (codeBarre) {
        const hit = selProdByBarcode.get(codeBarre);
        if (hit && hit.id != null) localId = hit.id;
      }
      if (localId == null && reference) {
        const hit2 = selProdByReference.get(reference);
        if (hit2 && hit2.id != null) localId = hit2.id;
      }

      if (localId != null) {
        updProdCore.run(
          r.nom ?? null,
          reference ?? null,
          Number(r.prix ?? 0),
          Number(r.stock ?? 0),
          codeBarre ?? null,
          localId
        );
        if (produitsHasRemote && remoteUUID) { try { updProdRemoteUuid.run(remoteUUID, localId); } catch {} }
        if (produitsHasUpdatedAt) { try { updProdUpdatedAt.run(r.updated_at || null, localId); } catch {} }
      } else {
        const values = [
          r.nom ?? null,
          reference ?? null,
          Number(r.prix ?? 0),
          Number(r.stock ?? 0),
          codeBarre ?? null,
        ];
        if (produitsHasRemote) values.push(remoteUUID);
        if (produitsHasUpdatedAt) values.push(r.updated_at || null);
        try { insProd.run(...values); } catch {}
      }
    }

    // 7) Modes de paiement (ton code existant)
    for (const m of modes_paiement) {
      const id = asIntOrNull(m.id);
      if (id == null) continue;
      upMode.run(id, m.nom, Number(m.taux_percent ?? 0), Number(m.frais_fixe ?? 0), b2i(!!m.actif));
    }
  });
  tx();


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
  return db.prepare(`
    SELECT id, device_id, op_type, entity_type, entity_id, payload_json
    FROM ops_queue WHERE ack = 0 ORDER BY created_at ASC LIMIT ?
  `).all(limit);
}
function countPendingOps() {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`).get();
  return r?.n || 0;
}

async function pushOpsNow(deviceId) {
  const ops = takePendingOps(200);
  if (ops.length === 0) {
    setState('online', { phase: 'idle', pending: 0 });
    return { ok: true, sent: 0, pending: 0 };
  }

  setState('pushing', { pending: ops.length });

  const payload = {
    deviceId,
    ops: ops.map(o => ({
      id: o.id,
      op_type: o.op_type,
      entity_type: o.entity_type,
      entity_id: o.entity_id,
      payload_json: o.payload_json
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
    setState('offline', { error: `HTTP ${res.status}`, pending: countPendingOps() });
    return { ok: false, error: `HTTP ${res.status} ${txt}`, pending: countPendingOps() };
  }

  const ids = ops.map(o => o.id);
  db.prepare(
    `UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE id IN (${ids.map(() => '?').join(',')})`
  ).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });

  try {
    await pullRefs();
  } catch (e) {
    setState('online', { phase: 'pull_failed', error: String(e) });
  }

  const left = countPendingOps();
  setState('online', { phase: 'idle', pending: left });
  return { ok: true, sent: ids.length, pending: left };
}

/* -------------------------------------------------
   BOOTSTRAP / HYDRATE
--------------------------------------------------*/
function collectLocalRefs() {
  // Nettoyage FK côté payload : si une FK pointe vers un id inexistant, on l’envoie en NULL.
  const exists = (table, id) => {
    const n = asIntOrNull(id);
    if (n == null) return false;
    try {
      const r = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(n);
      return !!r;
    } catch { return false; }
  };

  const all = (sql) => db.prepare(sql).all();

  const unites = all(`SELECT id, nom FROM unites ORDER BY id`);
  const familles = all(`SELECT id, nom FROM familles ORDER BY id`);
  const categories = all(`SELECT id, nom, famille_id FROM categories ORDER BY id`);
  const adherents = all(`
    SELECT id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
           nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation
    FROM adherents ORDER BY id
  `);
  const fournisseurs = all(`
    SELECT id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label
    FROM fournisseurs ORDER BY id
  `).map(f => ({
    ...f,
    categorie_id: exists('categories', f.categorie_id) ? f.categorie_id : null,
    referent_id: exists('adherents', f.referent_id) ? f.referent_id : null,
  }));

  const produits = all(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `).map(p => ({
    ...p,
    unite_id: exists('unites', p.unite_id) ? p.unite_id : null,
    fournisseur_id: exists('fournisseurs', p.fournisseur_id) ? p.fournisseur_id : null,
    categorie_id: exists('categories', p.categorie_id) ? p.categorie_id : null,
  }));

  const modes_paiement = all(`SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`);
  return { unites, familles, categories, adherents, fournisseurs, produits, modes_paiement };
}

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

  const json = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: json?.counts || {} });

  try { await pullRefs(); } catch (_) {}
  return { ok: true, bootstrapped: true, counts: json?.counts || {} };
}

async function hydrateOnStartup() {
  setState('pulling', { phase: 'startup' });
  await bootstrapIfNeeded();
  const r = await pullRefs();
  setState('online', { phase: 'startup_done' });
  return r;
}

async function pullAll() { return pullRefs(); }

/* -------------------------------------------------
   Auto sync périodique
--------------------------------------------------*/
let _autoTimer = null;
let _intervalMs = 30000; // 30s

function stopAutoSync() {
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
}

function startAutoSync(deviceId) {
  if (_autoTimer) return; // déjà en cours

  const loop = async () => {
    try {
      await pushOpsNow(deviceId);          // push
      _intervalMs = 30000;                 // reset backoff
    } catch (e) {
      _intervalMs = Math.min(_intervalMs + 15000, 120000); // backoff max 2 min
    } finally {
      _autoTimer = setTimeout(loop, _intervalMs); // planifie le prochain essai
    }
  };

  _autoTimer = setTimeout(loop, 1000); // première exécution in 1s
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
  const json = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: json?.counts || {} });
  await pullRefs();
  return { ok: true, counts: json?.counts || {} };
}

async function syncPushAll() {
  const { unites, familles, categories, adherents, fournisseurs, produits, modes_paiement } = collectLocalRefs();

  let res;
  try {
    res = await apiFetch('/sync/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ unites, familles, categories, adherents, fournisseurs, produits, modes_paiement }),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${String(e)}` };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status} ${txt}` };
  }
  const js = await res.json().catch(() => ({}));
  if (!js?.ok) return { ok: false, error: js?.error || 'Unknown bootstrap error' };

  notifyRenderer('data:refreshed', { from: 'push_all' });
  setState('online', { phase: 'idle' });
  return { ok: true, counts: js.counts || {} };
}

module.exports = {
  hydrateOnStartup,
  pullRefs,
  pullAll,
  pushOpsNow,
  startAutoSync,
  countPendingOps,
  pushBootstrapRefs,
  syncPushAll,
};
