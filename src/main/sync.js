// src/main/sync.js
const fetch = require('node-fetch');
const { BrowserWindow } = require('electron');
const db = require('./db/db');

const API_URL = process.env.CAISSE_API_URL || 'http://localhost:3001';

function notifyRenderer(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send(channel, payload); } catch(_) {}
  });
}

async function pullRefs({ since = null } = {}) {
  const url = new URL(`${API_URL}/sync/pull_refs`);
  if (since) url.searchParams.set('since', since);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`pull_refs ${res.status} ${await res.text().catch(()=> '')}`);
  const json = await res.json();
  const d = json?.data || {};
  const { unites=[], familles=[], categories=[], adherents=[], fournisseurs=[], produits=[] } = d;

  const upUnite = db.prepare(`INSERT INTO unites (id, nom) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET nom=excluded.nom`);
  const upFam   = db.prepare(`INSERT INTO familles (id, nom) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET nom=excluded.nom`);
  const upCat   = db.prepare(`
    INSERT INTO categories (id, nom, famille_id) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, famille_id=excluded.famille_id
  `);
  const upAdh   = db.prepare(`
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
  const upFour  = db.prepare(`
    INSERT INTO fournisseurs
      (id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, contact=excluded.contact, email=excluded.email, telephone=excluded.telephone,
      adresse=excluded.adresse, code_postal=excluded.code_postal, ville=excluded.ville,
      categorie_id=excluded.categorie_id, referent_id=excluded.referent_id, label=excluded.label
  `);
  const upProd  = db.prepare(`
    INSERT INTO produits
      (id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      nom=excluded.nom, reference=excluded.reference, prix=excluded.prix, stock=excluded.stock,
      code_barre=excluded.code_barre, unite_id=excluded.unite_id, fournisseur_id=excluded.fournisseur_id,
      categorie_id=excluded.categorie_id, updated_at=excluded.updated_at
  `);

  const tx = db.transaction(() => {
    for (const r of unites)       upUnite.run(r.id, r.nom);
    for (const r of familles)     upFam.run(r.id, r.nom);
    for (const r of categories)   upCat.run(r.id, r.nom, r.famille_id ?? null);
    for (const r of adherents)    upAdh.run(r.id, r.nom, r.prenom, r.email1, r.email2, r.telephone1, r.telephone2, r.adresse, r.code_postal, r.ville, r.nb_personnes_foyer, r.tranche_age, r.droit_entree, r.date_inscription, r.archive, r.date_archivage, r.date_reactivation);
    for (const r of fournisseurs) upFour.run(r.id, r.nom, r.contact, r.email, r.telephone, r.adresse, r.code_postal, r.ville, r.categorie_id ?? null, r.referent_id ?? null, r.label ?? null);
    for (const r of produits)     upProd.run(r.id, r.nom, r.reference, Number(r.prix ?? 0), Number(r.stock ?? 0), r.code_barre ?? null, r.unite_id ?? null, r.fournisseur_id ?? null, r.categorie_id ?? null, r.updated_at || null);
  });
  tx();

  // rafraîchit l’UI
  notifyRenderer('data:refreshed', { from: 'pull_refs' });
  return { ok: true, counts: { unites: unites.length, familles: familles.length, categories: categories.length, adherents: adherents.length, fournisseurs: fournisseurs.length, produits: produits.length } };
}

function takePendingOps(limit = 200) {
  return db.prepare(`
    SELECT id, device_id, op_type, entity_type, entity_id, payload_json
    FROM ops_queue WHERE ack = 0 ORDER BY created_at ASC LIMIT ?
  `).all(limit);
}

async function pushOpsNow(deviceId) {
  const ops = takePendingOps(200);
  if (ops.length === 0) return { ok: true, sent: 0 };
  const payload = {
    deviceId,
    ops: ops.map(o => ({ id: o.id, op_type: o.op_type, entity_type: o.entity_type, entity_id: o.entity_id, payload_json: o.payload_json })),
  };
  const res = await fetch(`${API_URL}/sync/push_ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`push_ops ${res.status} ${await res.text().catch(()=> '')}`);

  const ids = ops.map(o => o.id);
  db.prepare(`UPDATE ops_queue SET ack = 1, sent_at = datetime('now','localtime') WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });
  try { await pullRefs(); } catch {}
  return { ok: true, sent: ids.length };
}

// Démarrage
async function hydrateOnStartup() { return pullRefs(); }

// Alias lisible pour bouton “Pull tout”
async function pullAll() { return pullRefs(); }

module.exports = { hydrateOnStartup, pullRefs, pullAll, pushOpsNow };
