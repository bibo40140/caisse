// src/main/sync.js
'use strict';

const { BrowserWindow } = require('electron');
const db = require('./db/db');
const { apiFetch } = require('./apiClient');

// helpers
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
    ventes = [],
    lignes_vente = [],
    receptions = [],
    lignes_reception = [],
    // cotisations = [], // on les reçoit déjà mais on ne les importe pas encore proprement
  } = d;

  // --- UNITÉS
  const insUniteByName = db.prepare(`INSERT OR IGNORE INTO unites(nom) VALUES (?)`);

  // --- FAMILLES
  const insFamByName = db.prepare(`INSERT OR IGNORE INTO familles(nom) VALUES (?)`);
  const selFamIdByName = db.prepare(`SELECT id FROM familles WHERE nom = ?`);

  // --- CATÉGORIES
  const insCatByName = db.prepare(
    `INSERT OR IGNORE INTO categories(nom, famille_id) VALUES (?, ?)`
  );
  const selCatIdByName = db.prepare(`SELECT id, famille_id FROM categories WHERE nom = ?`);
  const updCatFamily = db.prepare(
    `UPDATE categories SET famille_id = ? WHERE id = ?`
  );

  // --- ADHÉRENTS : upsert par email1 (clé métier principale)
  const selAdhByEmail = db.prepare(
    `SELECT id FROM adherents WHERE email1 = ? LIMIT 1`
  );
  const insAdh = db.prepare(
    `
    INSERT INTO adherents
      (nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `
  );
  const updAdh = db.prepare(
    `
    UPDATE adherents SET
      nom = ?, prenom = ?, email1 = ?, email2 = ?, telephone1 = ?, telephone2 = ?, adresse = ?,
      code_postal = ?, ville = ?, nb_personnes_foyer = ?, tranche_age = ?, droit_entree = ?,
      date_inscription = ?, archive = ?, date_archivage = ?, date_reactivation = ?
    WHERE id = ?
  `
  );

  // --- FOURNISSEURS : upsert par nom (insensible à la casse)
  const selFourByName = db.prepare(
    `SELECT id FROM fournisseurs WHERE LOWER(nom) = LOWER(?) LIMIT 1`
  );
  const insFour = db.prepare(
    `
    INSERT INTO fournisseurs
      (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `
  );
  const updFour = db.prepare(
    `
    UPDATE fournisseurs SET
      nom = ?, contact = ?, email = ?, telephone = ?, adresse = ?, code_postal = ?, ville = ?,
      categorie_id = ?, referent_id = ?, label = ?
    WHERE id = ?
  `
  );

  // --- MODES DE PAIEMENT : upsert par nom
  const selModeByName = db.prepare(
    `SELECT id FROM modes_paiement WHERE nom = ? LIMIT 1`
  );
  const insMode = db.prepare(
    `
    INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
    VALUES (?,?,?,?)
  `
  );
  const updMode = db.prepare(
    `
    UPDATE modes_paiement SET
      taux_percent = ?, frais_fixe = ?, actif = ?
    WHERE id = ?
  `
  );

  // --- PRODUITS
  const produitsHasRemote = hasCol('produits', 'remote_uuid');
  const produitsHasUpdatedAt = hasCol('produits', 'updated_at');

  const selProdByBarcode = db.prepare(
    `
    SELECT id FROM produits
    WHERE REPLACE(COALESCE(code_barre,''),' ','') = REPLACE(COALESCE(?,''),' ','')
    LIMIT 1
  `
  );
  const selProdByReference = db.prepare(
    `SELECT id FROM produits WHERE reference = ? LIMIT 1`
  );
  const updProdCore = db.prepare(
    `
    UPDATE produits
       SET nom        = COALESCE(?, nom),
           reference  = COALESCE(?, reference),
           prix       = COALESCE(?, prix),
           stock      = COALESCE(?, stock),
           code_barre = COALESCE(?, code_barre)
     WHERE id = ?
  `
  );
  const updProdRemoteUuid = produitsHasRemote
    ? db.prepare(`UPDATE produits SET remote_uuid = ? WHERE id = ?`)
    : null;
  const updProdUpdatedAt = produitsHasUpdatedAt
    ? db.prepare(`UPDATE produits SET updated_at = ? WHERE id = ?`)
    : null;

  const insProdBaseColumns = (() => {
    const cols = ['nom', 'reference', 'prix', 'stock', 'code_barre'];
    if (produitsHasRemote) cols.push('remote_uuid');
    if (produitsHasUpdatedAt) cols.push('updated_at');
    const placeholders = cols.map(() => '?').join(',');
    return { cols, placeholders };
  })();

  const insProd = db.prepare(
    `
    INSERT INTO produits (${insProdBaseColumns.cols.join(',')})
    VALUES (${insProdBaseColumns.placeholders})
  `
  );

  // --- VENTES / LIGNES DE VENTE (historique)
  const insVente = db.prepare(
    `
    INSERT INTO ventes
      (id, total, adherent_id, date_vente, mode_paiement_id, frais_paiement, cotisation, sale_type, client_email)
    VALUES (?,?,?,?,?,?,?,?,?)
  `
  );
  const insLigneVente = db.prepare(
    `
    INSERT INTO lignes_vente
      (id, vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
    VALUES (?,?,?,?,?,?,?)
  `
  );

  // --- RÉCEPTIONS / LIGNES DE RÉCEPTION
  const insReception = db.prepare(
    `
    INSERT INTO receptions
      (id, fournisseur_id, date, reference)
    VALUES (?,?,?,?)
  `
  );
  const insLigneReception = db.prepare(
    `
    INSERT INTO lignes_reception
      (id, reception_id, produit_id, quantite, prix_unitaire)
    VALUES (?,?,?,?,?)
  `
  );

  // === Transaction locale ===
  const tx = db.transaction(() => {
    // RESET des tables de référentiels + historique pour le tenant courant
    db.prepare('DELETE FROM lignes_vente').run();
    db.prepare('DELETE FROM ventes').run();
    db.prepare('DELETE FROM lignes_reception').run();
    db.prepare('DELETE FROM receptions').run();
    // On laisse cotisations pour l’instant (pas encore mappé correctement)
    // db.prepare('DELETE FROM cotisations').run();

    db.prepare('DELETE FROM modes_paiement').run();
    db.prepare('DELETE FROM produits').run();
    db.prepare('DELETE FROM fournisseurs').run();
    db.prepare('DELETE FROM adherents').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM familles').run();
    db.prepare('DELETE FROM unites').run();

    // Unités
    for (const r of unites) {
      const name = (r.nom || '').trim();
      if (!name) continue;
      insUniteByName.run(name);
    }

    // Familles
    const famUuidToLocalId = new Map();
    for (const r of familles) {
      const name = (r.nom || '').trim();
      const remoteId = String(r.id || '');
      if (!name || !remoteId) continue;
      insFamByName.run(name);
      const row = selFamIdByName.get(name);
      if (row && row.id != null) famUuidToLocalId.set(remoteId, row.id);
    }

    // Catégories
    for (const r of categories) {
      const name = (r.nom || '').trim();
      if (!name) continue;
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
      }
    }

    // Produits
    for (const r of produits) {
      const remoteUUID = r.id || null;
      const codeBarre = r.code_barre || null;
      const reference = r.reference || null;

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
        // UPDATE
        updProdCore.run(
          r.nom ?? null,
          reference ?? null,
          Number(r.prix ?? 0),
          Number(r.stock ?? 0),
          codeBarre ?? null,
          localId
        );
        if (produitsHasRemote && remoteUUID) {
          try {
            updProdRemoteUuid.run(String(remoteUUID), localId);
          } catch {}
        }
        if (produitsHasUpdatedAt) {
          try {
            updProdUpdatedAt.run(r.updated_at || null, localId);
          } catch {}
        }
      } else {
        // INSERT
        const values = [
          r.nom ?? null,
          reference ?? null,
          Number(r.prix ?? 0),
          Number(r.stock ?? 0),
          codeBarre ?? null,
        ];
        if (produitsHasRemote) values.push(String(remoteUUID || ''));
        if (produitsHasUpdatedAt) values.push(r.updated_at || null);
        try {
          insProd.run(...values);
        } catch {}
      }
    }

    // Construire une map remote_uuid -> id local pour mapper les lignes
    let prodRemoteToLocal = null;
    if (produitsHasRemote) {
      prodRemoteToLocal = new Map();
      const rows = db
        .prepare(
          `SELECT id, remote_uuid FROM produits WHERE remote_uuid IS NOT NULL`
        )
        .all();
      for (const row of rows) {
        prodRemoteToLocal.set(String(row.remote_uuid), row.id);
      }
    }

    // Adhérents
    for (const r of adherents) {
      const email = (r.email1 || '').trim().toLowerCase();

      const base = [
        r.nom || '',
        r.prenom || '',
        email || null,
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

      let existing = null;
      if (email) {
        existing = selAdhByEmail.get(email);
      }

      if (existing && existing.id != null) {
        updAdh.run(...base, existing.id);
      } else {
        insAdh.run(...base);
      }
    }

    // Fournisseurs
    for (const r of fournisseurs) {
      const nom = (r.nom || '').trim();
      if (!nom) continue;

      const base = [
        nom,
        r.contact || null,
        r.email || null,
        r.telephone || null,
        r.adresse || null,
        r.code_postal || null,
        r.ville || null,
        null, // categorie_id (mapping UUID -> local à faire plus tard si besoin)
        null, // referent_id
        r.label ?? null,
      ];

      const row = selFourByName.get(nom);

      if (row && row.id != null) {
        updFour.run(...base, row.id);
      } else {
        insFour.run(...base);
      }
    }

    // Modes de paiement
    for (const m of modes_paiement) {
      const nom = (m.nom || '').trim();
      if (!nom) continue;

      const taux = Number(m.taux_percent ?? 0);
      const frais = Number(m.frais_fixe ?? 0);
      const actif = b2i(!!m.actif);

      const row = selModeByName.get(nom);

      if (row && row.id != null) {
        updMode.run(taux, frais, actif, row.id);
      } else {
        insMode.run(nom, taux, frais, actif);
      }
    }

    // === HISTORIQUE VENTES ===
    for (const v of ventes) {
      const id = v.id ?? null;
      const total = Number(v.total ?? 0);
      const dateVente = v.date_vente || null;
      const saleType = v.sale_type || 'adherent';
      const clientEmail = v.client_email || null;
      const frais = Number(v.frais_paiement ?? 0);
      const cotisation = Number(v.cotisation ?? 0);

      // Pour l’instant : on ne mappe pas encore adherent_id et mode_paiement_id
      insVente.run(
        id,
        total,
        null, // adherent_id (sera 0/null => lien non reconstruit pour l’instant)
        dateVente,
        null, // mode_paiement_id
        frais,
        cotisation,
        saleType,
        clientEmail
      );
    }

    // Lignes de vente
    if (lignes_vente.length && prodRemoteToLocal) {
      for (const l of lignes_vente) {
        const remoteProdId = l.produit_id;
        if (remoteProdId == null) continue;

        const localProdId = prodRemoteToLocal.get(String(remoteProdId));
        if (!localProdId) {
          // produit non trouvé localement → on skip la ligne
          continue;
        }

        const ligneId = l.id ?? null;
        const venteId = l.vente_id ?? null;
        const quantite = Number(l.quantite ?? 0);
        const prix = Number(l.prix ?? 0);
        const prixUnitaire = l.prix_unitaire != null ? Number(l.prix_unitaire) : null;
        const remise = Number(l.remise_percent ?? 0);

        insLigneVente.run(
          ligneId,
          venteId,
          localProdId,
          quantite,
          prix,
          prixUnitaire,
          remise
        );
      }
    }

    // === HISTORIQUE RÉCEPTIONS ===
    for (const r of receptions) {
      const id = r.id ?? null;
      const date = r.date || null;
      const reference = r.reference || null;
      // On ne mappe pas encore fournisseur_id (on n'a pas de remote_uuid fournisseur)
      insReception.run(id, null, date, reference);
    }

    if (lignes_reception.length && prodRemoteToLocal) {
      for (const l of lignes_reception) {
        const remoteProdId = l.produit_id;
        if (remoteProdId == null) continue;

        const localProdId = prodRemoteToLocal.get(String(remoteProdId));
        if (!localProdId) {
          continue;
        }

        const ligneId = l.id ?? null;
        const receptionId = l.reception_id ?? null;
        const quantite = Number(l.quantite ?? 0);
        const prixUnitaire =
          l.prix_unitaire != null ? Number(l.prix_unitaire) : null;

        insLigneReception.run(
          ligneId,
          receptionId,
          localProdId,
          quantite,
          prixUnitaire
        );
      }
    }

    // ⚠️ Cotisations : pour l'instant on ne les importe pas encore,
    // car le mapping adherent_id ↔ adhérent est plus délicat.
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
      ventes: ventes.length,
      lignes_vente: lignes_vente.length,
      receptions: receptions.length,
      lignes_reception: lignes_reception.length,
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
    ops: ops.map((o) => ({
      id: o.id,
      op_type: o.op_type,
      entity_type: o.entity_type,
      entity_id: o.entity_id,
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
    setState('offline', { error: `HTTP ${res.status}`, pending: countPendingOps() });
    return { ok: false, error: `HTTP ${res.status} ${txt}`, pending: countPendingOps() };
  }

  const ids = ops.map((o) => o.id);
  db.prepare(
    `UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE id IN (${ids
      .map(() => '?')
      .join(',')})`
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
  const adherents = all(
    `
    SELECT id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
           nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation
    FROM adherents ORDER BY id
  `
  );
  const fournisseurs = all(
    `
    SELECT id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label
    FROM fournisseurs ORDER BY id
  `
  ).map((f) => ({
    ...f,
    categorie_id: exists('categories', f.categorie_id) ? f.categorie_id : null,
    referent_id: exists('adherents', f.referent_id) ? f.referent_id : null,
  }));

  const produits = all(
    `
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `
  ).map((p) => ({
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

async function hydrateOnStartup() {
  setState('pulling', { phase: 'startup' });
  await bootstrapIfNeeded();
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

function startAutoSync(deviceId) {
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

async function syncPushAll() {
  const payload = collectLocalRefs();
  let res;
  try {
    res = await apiFetch('/sync/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
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
