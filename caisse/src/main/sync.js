// src/main/sync.js
const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');
const b2i = (v) => (v ? 1 : 0);

/* -------------------------------------------------
   API base
--------------------------------------------------*/
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

/* petites aides pour le chip */
function setState(status, info = {}) {
  // status: 'online' | 'offline' | 'pushing' | 'pulling' | 'idle'
  notifyRenderer('sync:state', { status, ...info, ts: Date.now() });
}

/* -------------------------------------------------
   PULL refs depuis Neon -> Sauvegarde locale
--------------------------------------------------*/
async function pullRefs({ since = null } = {}) {
  const url = new URL(`${API_URL}/sync/pull_refs`);
  if (since) url.searchParams.set('since', since);

  setState('pulling');
  let res;
  try {
    res = await fetch(url.toString());
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

  const upUnite = db.prepare(
    `INSERT INTO unites (id, nom) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET nom=excluded.nom`
  );
  const upFam = db.prepare(
    `INSERT INTO familles (id, nom) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET nom=excluded.nom`
  );
  const upCat = db.prepare(`
    INSERT INTO categories (id, nom, famille_id) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, famille_id=excluded.famille_id
  `);
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
  const upProd = db.prepare(`
    INSERT INTO produits
      (id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, reference=excluded.reference, prix=excluded.prix, stock=excluded.stock,
      code_barre=excluded.code_barre, unite_id=excluded.unite_id, fournisseur_id=excluded.fournisseur_id,
      categorie_id=excluded.categorie_id, updated_at=excluded.updated_at
  `);
  const upMode = db.prepare(`
    INSERT INTO modes_paiement (id, nom, taux_percent, frais_fixe, actif)
    VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, taux_percent=excluded.taux_percent, frais_fixe=excluded.frais_fixe, actif=excluded.actif
  `);

  const tx = db.transaction(() => {
    for (const r of unites) upUnite.run(r.id, r.nom);
    for (const r of familles) upFam.run(r.id, r.nom);
    for (const r of categories) upCat.run(r.id, r.nom, r.famille_id ?? null);

    for (const r of adherents)
      upAdh.run(
        r.id, r.nom, r.prenom, r.email1, r.email2, r.telephone1, r.telephone2, r.adresse,
        r.code_postal, r.ville, r.nb_personnes_foyer, r.tranche_age, Number(r.droit_entree ?? 0),
        r.date_inscription, b2i(r.archive), r.date_archivage, r.date_reactivation
      );

    for (const r of fournisseurs)
      upFour.run(
        r.id, r.nom, r.contact, r.email, r.telephone, r.adresse, r.code_postal, r.ville,
        r.categorie_id ?? null, r.referent_id ?? null, r.label ?? null
      );

    for (const r of produits)
      upProd.run(
        r.id, r.nom, r.reference, Number(r.prix ?? 0), Number(r.stock ?? 0),
        r.code_barre ?? null, r.unite_id ?? null, r.fournisseur_id ?? null, r.categorie_id ?? null, r.updated_at || null
      );

    for (const m of modes_paiement)
      upMode.run(m.id, m.nom, Number(m.taux_percent ?? 0), Number(m.frais_fixe ?? 0), b2i(!!m.actif));
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
      id: o.id, op_type: o.op_type, entity_type: o.entity_type, entity_id: o.entity_id, payload_json: o.payload_json
    })),
  };

  let res;
  try {
    res = await fetch(`${API_URL}/sync/push_ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    // pull raté mais push ok ⇒ on reste "online" avec phase erreur pull
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
  `);
  const produits = all(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `);
  const modes_paiement = all(`SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`);
  return { unites, familles, categories, adherents, fournisseurs, produits, modes_paiement };
}

async function bootstrapIfNeeded() {
  let needed = false;
  try {
    const r = await fetch(`${API_URL}/sync/bootstrap_needed`);
    if (r.ok) {
      const j = await r.json();
      needed = !!j?.needed;
    }
  } catch (e) {
    setState('offline', { error: String(e) });
  }
  if (!needed) return { ok: true, bootstrapped: false };

  const refs = collectLocalRefs();
  let resp;
  try {
    resp = await fetch(`${API_URL}/sync/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
function startAutoSync(deviceId) {
  if (_autoTimer) return;
  _autoTimer = setInterval(async () => {
    try {
      await pushOpsNow(deviceId);
      _intervalMs = 30000;
    } catch {
      _intervalMs = Math.min(_intervalMs + 15000, 120000);
      clearInterval(_autoTimer);
      _autoTimer = null;
      _autoTimer = setInterval(() => startAutoSync(deviceId), _intervalMs);
    }
  }, _intervalMs);
}

/* -------------------------------------------------
   Export public
--------------------------------------------------*/
async function pushBootstrapRefs() {
  const refs = collectLocalRefs();
  const resp = await fetch(`${API_URL}/sync/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  `);
  const produits = all(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `);
  const modes_paiement = all(`SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`);

  let res;
  try {
    res = await fetch(`${API_URL}/sync/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
