// src/main/db/produits.js
const db = require('./db');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// Helpers
function toNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function genRefFromName(nom = '') {
  const slug = String(nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `P-${slug || 'prod'}-${Date.now().toString().slice(-6)}`;
}

// ─────────────────────────────────────────────────────────────
// LECTURE (avec catégorie/famille *effectives*)
// ─────────────────────────────────────────────────────────────
function getProduits({ search = '', limit = 5000, offset = 0 } = {}) {
  const params = [];
  let where = '1=1';
  if (search) {
    where += ` AND (p.nom LIKE ? OR p.reference LIKE ? OR p.code_barre LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  return db.prepare(`
    SELECT
      p.id,
      p.nom,
      p.reference,
      COALESCE(p.stock, 0) AS stock,
      p.prix,
      p.code_barre,
      p.unite_id,
      p.fournisseur_id,
      p.categorie_id,
      p.updated_at,

      u.nom AS unite,
      u.nom AS unite_nom,
      f.nom AS fournisseur_nom,

      -- catégorie d'origine du produit (peut être NULL)
      c_prod.nom AS categorie_nom,

      -- catégorie/famille *effectives* (produit OU fournisseur)
      c_eff.id  AS categorie_effective_id,
      c_eff.nom AS categorie_effective_nom,
      fam.id  AS famille_effective_id,
      fam.nom AS famille_effective_nom


    FROM produits p
    LEFT JOIN unites       u      ON u.id   = p.unite_id
    LEFT JOIN fournisseurs f      ON f.id   = p.fournisseur_id
    LEFT JOIN categories   c_prod ON c_prod.id = p.categorie_id
    LEFT JOIN categories   c_eff  ON c_eff.id  = COALESCE(p.categorie_id, f.categorie_id)
    LEFT JOIN familles     fam    ON fam.id    = c_eff.famille_id
    WHERE ${where}
    ORDER BY p.id
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));
}

function countProduits({ search = '' } = {}) {
  const params = [];
  let where = '1=1';
  if (search) {
    where += ` AND (nom LIKE ? OR reference LIKE ? OR code_barre LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const r = db.prepare(`SELECT COUNT(*) AS n FROM produits WHERE ${where}`).get(...params);
  return r?.n || 0;
}

function getProduit(id) {
  return db.prepare(`
    SELECT
      p.id,
      p.nom,
      p.reference,
      COALESCE(p.stock, 0) AS stock,
      p.prix,
      p.code_barre,
      p.unite_id,
      p.fournisseur_id,
      p.categorie_id,
      p.updated_at,

      u.nom AS unite,
      u.nom AS unite_nom,
      f.nom AS fournisseur_nom,

      c_prod.nom AS categorie_nom,

      c_eff.id  AS categorie_effective_id,
      c_eff.nom AS categorie_effective_nom,
      fam.id    AS famille_effective_id,
      fam.nom   AS famille_effective_nom
    FROM produits p
    LEFT JOIN unites       u      ON u.id   = p.unite_id
    LEFT JOIN fournisseurs f      ON f.id   = p.fournisseur_id
    LEFT JOIN categories   c_prod ON c_prod.id = p.categorie_id
    LEFT JOIN categories   c_eff  ON c_eff.id  = COALESCE(p.categorie_id, f.categorie_id)
    LEFT JOIN familles     fam    ON fam.id    = c_eff.famille_id
    WHERE p.id = ?
  `).get(Number(id));
}

// ─────────────────────────────────────────────────────────────
// ÉCRITURE
// ─────────────────────────────────────────────────────────────
function ajouterProduit(p = {}) {
  const nom = p.nom || 'Nouveau produit';
  const reference = p.reference || genRefFromName(nom);
  const prix = toNumber(p.prix, 0);
  const code_barre = p.code_barre || null;
  const unite_id = p.unite_id ?? null;
  const fournisseur_id = p.fournisseur_id ?? null;
  const categorie_id = p.categorie_id ?? null;
  const stockInit = toNumber(p.stock, 0);

  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO produits (nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
      VALUES (?,?,?,?,?,?,?,?, datetime('now','localtime'))
    `).run(nom, reference, prix, stockInit, code_barre, unite_id, fournisseur_id, categorie_id);
    const id = r.lastInsertRowid;

    if (stockInit !== 0) {
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'inventory.adjust',
        entityType: 'produit',
        entityId: String(id),
        payload: { produitId: id, delta: stockInit, reason: 'create.initial_stock' },
      });
    }

    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(()=>{});
    } catch {}
    return id;
  });
  return tx();
}

/**
 * Modifier un produit.
 * - Si "stock" est fourni : delta = nouveau - actuel => inventory.adjust
 * - Si "prix"/champs changent : product.updated
 */
function modifierProduit(p = {}) {
  const id = Number(p.id);
  if (!Number.isFinite(id)) throw new Error('id produit manquant');

  const cur = db.prepare(`SELECT * FROM produits WHERE id = ?`).get(id);
  if (!cur) throw new Error('produit introuvable');

  const fields = [];
  const values = [];
  function setField(col, val) { fields.push(`${col} = ?`); values.push(val); }

  const nom = (p.nom !== undefined) ? String(p.nom) : cur.nom;
  const reference = (p.reference !== undefined) ? String(p.reference) : cur.reference;
  const code_barre = (p.code_barre !== undefined) ? (p.code_barre || null) : cur.code_barre;
  const prix = (p.prix !== undefined) ? toNumber(p.prix, cur.prix) : cur.prix;
  const unite_id = (p.unite_id !== undefined) ? (p.unite_id ?? null) : cur.unite_id;
  const fournisseur_id = (p.fournisseur_id !== undefined) ? (p.fournisseur_id ?? null) : cur.fournisseur_id;
  const categorie_id = (p.categorie_id !== undefined) ? (p.categorie_id ?? null) : cur.categorie_id;

  const stockProvided = (p.stock !== undefined);
  const newStock = stockProvided ? toNumber(p.stock, cur.stock) : cur.stock;
  const delta = stockProvided ? (newStock - toNumber(cur.stock, 0)) : 0;

  const tx = db.transaction(() => {
    setField('nom', nom);
    setField('reference', reference);
    setField('code_barre', code_barre);
    setField('prix', prix);
    setField('unite_id', unite_id);
    setField('fournisseur_id', fournisseur_id);
    setField('categorie_id', categorie_id);
    if (stockProvided) setField('stock', newStock);

    const sql = `
      UPDATE produits
      SET ${fields.join(', ')}, updated_at = datetime('now','localtime')
      WHERE id = ?
    `;
    db.prepare(sql).run(...values, id);

    enqueueOp({
      deviceId: DEVICE_ID,
      opType: 'product.updated',
      entityType: 'produit',
      entityId: String(id),
      payload: { id, nom, reference, code_barre, prix, unite_id, fournisseur_id, categorie_id },
    });

    if (stockProvided && delta !== 0) {
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'inventory.adjust',
        entityType: 'produit',
        entityId: String(id),
        payload: { produitId: id, delta, reason: 'manual.edit' },
      });
    }

    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(()=>{});
    } catch {}
  });

  tx();
  return { ok: true };
}

function supprimerProduit(id) {
  db.prepare(`DELETE FROM produits WHERE id = ?`).run(Number(id));
  return { ok: true };
}

function getCategoriesProduitsEffectives() {
  return db.prepare(`
    SELECT
      c_eff.id,
      c_eff.nom,
      COUNT(p.id) AS nb
    FROM produits p
    LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id
    LEFT JOIN categories c_eff ON c_eff.id = COALESCE(p.categorie_id, f.categorie_id)
    GROUP BY c_eff.id, c_eff.nom
    ORDER BY c_eff.nom
  `).all();
}

module.exports = {
  getProduits,
  countProduits,
  getProduit,
  ajouterProduit,
  modifierProduit,
  supprimerProduit,
  getCategoriesProduitsEffectives,
};
