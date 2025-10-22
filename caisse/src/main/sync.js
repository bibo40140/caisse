// src/main/sync.js
// 👉 Version "drop-in" compatible avec ton code existant
//    - Conserve API_URL, deviceId (camelCase), payload_json (string), notifyRenderer
//    - Ajoute un recalage de stock optionnel via /inventory/stocks (si dispo)
//    - Garde pullRefs() comme source principale si /inventory/stocks n'existe pas

const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');
const b2i = (v) => (v ? 1 : 0);

/* -------------------------------------------------
   API base (conserve ta logique)
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

/* -------------------------------------------------
   PULL refs (Neon → local) — conserve ta version
--------------------------------------------------*/
async function pullRefs({ since = null } = {}) {
  const url = new URL(`${API_URL}/sync/pull_refs`);
  if (since) url.searchParams.set('since', since);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text().catch(() => '');
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
        r.id,
        r.nom,
        r.prenom,
        r.email1,
        r.email2,
        r.telephone1,
        r.telephone2,
        r.adresse,
        r.code_postal,
        r.ville,
        r.nb_personnes_foyer,
        r.tranche_age,
        Number(r.droit_entree ?? 0),
        r.date_inscription,
        b2i(r.archive),
        r.date_archivage,
        r.date_reactivation
      );

    for (const r of fournisseurs)
      upFour.run(
        r.id,
        r.nom,
        r.contact,
        r.email,
        r.telephone,
        r.adresse,
        r.code_postal,
        r.ville,
        r.categorie_id ?? null,
        r.referent_id ?? null,
        r.label ?? null
      );

    for (const r of produits)
      upProd.run(
        r.id,
        r.nom,
        r.reference,
        Number(r.prix ?? 0),
        Number(r.stock ?? 0),
        r.code_barre ?? null,
        r.unite_id ?? null,
        r.fournisseur_id ?? null,
        r.categorie_id ?? null,
        r.updated_at || null
      );

    for (const m of modes_paiement) {
      upMode.run(
        m.id,
        m.nom,
        Number(m.taux_percent ?? 0),
        Number(m.frais_fixe ?? 0),
        b2i(!!m.actif)
      );
    }
  });
  tx();

  notifyRenderer('data:refreshed', { from: 'pull_refs' });
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
   Recalage "serveur = vérité" (optionnel)
   - Si /inventory/stocks existe : on l'utilise pour juste mettre à jour les stocks.
   - Sinon, on retombe sur pullRefs() (complet).
--------------------------------------------------*/
async function pullServerStocksIfAvailable() {
  let res;
  try {
    res = await fetch(`${API_URL}/inventory/stocks`);
  } catch (_) {
    return { ok: false, error: 'réseau stocks' };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  let list = [];
  try { list = await res.json(); } catch (_) {}
  if (!Array.isArray(list)) return { ok: false, error: 'format' };

  const tx = db.transaction(() => {
    const upd = db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`);
    for (const row of list) {
      const pid = Number(row.produit_id);
      const qty = Number(row.qty);
      if (Number.isFinite(pid)) upd.run(Number.isFinite(qty) ? qty : 0, pid);
    }
  });
  tx();

  notifyRenderer('data:refreshed', { from: 'pull_stocks' });
  return { ok: true, updated: list.length };
}

/* -------------------------------------------------
   OPS queue → push (conserve deviceId + payload_json)
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
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`).get();
  return r?.n || 0;
}

async function pushOpsNow(deviceId) {
  const ops = takePendingOps(200);
  if (ops.length === 0) return { ok: true, sent: 0, pending: 0 };

  const payload = {
    deviceId, // 👈 conserve le camelCase de ta version
    ops: ops.map((o) => ({
      id: o.id,
      op_type: o.op_type,
      entity_type: o.entity_type,
      entity_id: o.entity_id,
      payload_json: o.payload_json, // 👈 on envoie du JSON string, comme avant
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
    console.error('[sync] push_ops network error:', e?.message || e);
    return { ok: false, error: String(e), pending: countPendingOps() };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[sync] push_ops HTTP', res.status, txt);
    return { ok: false, error: `HTTP ${res.status} ${txt}`, pending: countPendingOps() };
  }

  // Idéalement l’API devrait renvoyer les opIds ackés; si non, on ack tout le batch
  const ids = ops.map((o) => o.id);
  db.prepare(
    `UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE id IN (${ids
      .map(() => '?')
      .join(',')})`
  ).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });

  // Recalage "serveur = vérité"
  // 1) Si /inventory/stocks existe → rapide
  const stocks = await pullServerStocksIfAvailable();
  if (!stocks.ok) {
    // 2) Sinon, on retombe sur ton pullRefs() (complet)
    try { await pullRefs(); } catch (e) { console.warn('[sync] pull after push failed:', e?.message || e); }
  }

  return { ok: true, sent: ids.length, pending: countPendingOps() };
}

/* -------------------------------------------------
   BOOTSTRAP (conserve ta version)
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
  const modes_paiement = all(`
    SELECT id, nom, taux_percent, frais_fixe, actif
    FROM modes_paiement ORDER BY id
  `);

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
    console.warn('[sync] bootstrap_needed probe failed:', e?.message || e);
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
    console.error('[sync] bootstrap network error:', e?.message || e);
    return { ok: false, error: String(e) };
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error('[sync] bootstrap HTTP', resp.status, txt);
    return { ok: false, error: `HTTP ${resp.status} ${txt}` };
  }

  const json = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: json?.counts || {} });

  try { await pullRefs(); } catch (_) {}
  return { ok: true, bootstrapped: true, counts: json?.counts || {} };
}

/* -------------------------------------------------
   Démarrage + utilitaires (mêmes exports)
--------------------------------------------------*/
async function hydrateOnStartup() {
  await bootstrapIfNeeded();
  return pullRefs();
}

async function pullAll() {
  return pullRefs();
}

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
  const fetchAll = (sql) => db.prepare(sql).all();

  const unites = fetchAll(`SELECT id, nom FROM unites ORDER BY id`);
  const familles = fetchAll(`SELECT id, nom FROM familles ORDER BY id`);
  const categories = fetchAll(`SELECT id, nom, famille_id FROM categories ORDER BY id`);
  const adherents = fetchAll(`
    SELECT id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
           nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation
    FROM adherents ORDER BY id
  `);
  const fournisseurs = fetchAll(`
    SELECT id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label
    FROM fournisseurs ORDER BY id
  `);
  const produits = fetchAll(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `);
  const modes_paiement = fetchAll(`
    SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id
  `);

  let res;
  try {
    res = await fetch(`${API_URL}/sync/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        unites, familles, categories, adherents, fournisseurs, produits, modes_paiement
      }),
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
