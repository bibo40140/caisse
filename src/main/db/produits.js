// src/main/db/produits.js
const db = require('./db');

// ------------------------------
// Helpers
// ------------------------------
function toNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function genRefFromName(nom = '') {
  // P-<slug>-<timestamp court>
  const slug = String(nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 10);
  return `P-${slug || 'ITEM'}-${Date.now().toString(36).toUpperCase()}`;
}

function ensureUniqueReference(ref) {
  let candidate = ref || genRefFromName();
  const exists = db.prepare(`SELECT 1 FROM produits WHERE reference = ?`).get(candidate);
  if (!exists) return candidate;
  // petit suffixe en cas de collision
  let i = 1;
  while (db.prepare(`SELECT 1 FROM produits WHERE reference = ?`).get(candidate)) {
    candidate = `${ref || 'P'}-${(Date.now()+i).toString(36).toUpperCase()}`;
    i++;
  }
  return candidate;
}

// ------------------------------
// SELECTs avec catégorie/famille “effectives”
// ------------------------------
const SELECT_FIELDS = `
  p.id,
  p.nom,
  p.reference,
  p.prix,
  p.stock,
  p.code_barre,
  p.unite_id,
  u.nom                  AS unite,

  p.fournisseur_id,
  f.nom                  AS fournisseur_nom,
  f.categorie_id         AS fournisseur_categorie_id,

  p.categorie_id,

  -- ✅ Catégorie/famille effectives (produit OU fournisseur)
  COALESCE(p.categorie_id, f.categorie_id)         AS categorie_effective_id,
  c_eff.nom                                        AS categorie_effective_nom,
  fam.id                                           AS famille_effective_id,
  fam.nom                                          AS famille_effective_nom
`;

const STMT_LIST = db.prepare(`
  SELECT ${SELECT_FIELDS}
  FROM produits p
  LEFT JOIN unites       u     ON u.id      = p.unite_id
  LEFT JOIN fournisseurs f     ON f.id      = p.fournisseur_id
  LEFT JOIN categories   c_eff ON c_eff.id  = COALESCE(p.categorie_id, f.categorie_id)
  LEFT JOIN familles     fam   ON fam.id    = c_eff.famille_id
  ORDER BY p.nom COLLATE NOCASE
`);

const STMT_GET = db.prepare(`
  SELECT ${SELECT_FIELDS}
  FROM produits p
  LEFT JOIN unites       u     ON u.id      = p.unite_id
  LEFT JOIN fournisseurs f     ON f.id      = p.fournisseur_id
  LEFT JOIN categories   c_eff ON c_eff.id  = COALESCE(p.categorie_id, f.categorie_id)
  LEFT JOIN familles     fam   ON fam.id    = c_eff.famille_id
  WHERE p.id = ?
`);

// ------------------------------
// API
// ------------------------------
function getProduits() {
  return STMT_LIST.all();
}

function getProduit(id) {
  return STMT_GET.get(id);
}

const STMT_INSERT = db.prepare(`
  INSERT INTO produits (nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id)
  VALUES (@nom, @reference, @prix, @stock, @code_barre, @unite_id, @fournisseur_id, @categorie_id)
`);

function ajouterProduit(payload = {}) {
  const data = {
    nom:           String(payload.nom || '').trim(),
    reference:     (payload.reference && String(payload.reference).trim()) || null,
    prix:          toNumber(payload.prix, 0),
    stock:         toNumber(payload.stock, 0),
    code_barre:    payload.code_barre ? String(payload.code_barre).trim() : null,
    unite_id:      payload.unite_id ? Number(payload.unite_id) : null,
    fournisseur_id:payload.fournisseur_id ? Number(payload.fournisseur_id) : null,
    categorie_id:  payload.categorie_id ? Number(payload.categorie_id) : null,
  };
  if (!data.nom) throw new Error('Nom requis');

  // Génère une référence si absente
  data.reference = ensureUniqueReference(data.reference || genRefFromName(data.nom));

  const info = STMT_INSERT.run(data);
  return getProduit(info.lastInsertRowid);
}

const STMT_UPDATE = db.prepare(`
  UPDATE produits
     SET nom            = @nom,
         reference      = COALESCE(@reference, reference),  -- garde l’existante si null
         prix           = @prix,
         stock          = @stock,
         code_barre     = @code_barre,
         unite_id       = @unite_id,
         fournisseur_id = @fournisseur_id,
         categorie_id   = @categorie_id
   WHERE id = @id
`);

function modifierProduit(payload = {}) {
  const id = Number(payload.id);
  if (!id) throw new Error('ID produit manquant');

  // Lire l’existant pour éviter d’écraser par des null/undefined involontaires
  const cur = db.prepare(`SELECT * FROM produits WHERE id = ?`).get(id);
  if (!cur) throw new Error('Produit introuvable');

  // Prépare la mise à jour champ par champ
  const merged = {
    id,
    nom:            (payload.nom ?? cur.nom) ? String(payload.nom ?? cur.nom).trim() : cur.nom,
    reference:      payload.reference === undefined
                      ? null    // => COALESCE gardera cur.reference
                      : (payload.reference ? String(payload.reference).trim() : null),
    prix:           toNumber(payload.prix ?? cur.prix, cur.prix),
    stock:          toNumber(payload.stock ?? cur.stock, cur.stock),
    code_barre:     payload.code_barre === undefined
                      ? (cur.code_barre ?? null)
                      : (payload.code_barre ? String(payload.code_barre).trim() : null),
    unite_id:       payload.unite_id !== undefined
                      ? (payload.unite_id ? Number(payload.unite_id) : null)
                      : (cur.unite_id ?? null),
    fournisseur_id: payload.fournisseur_id !== undefined
                      ? (payload.fournisseur_id ? Number(payload.fournisseur_id) : null)
                      : (cur.fournisseur_id ?? null),
    categorie_id:   payload.categorie_id !== undefined
                      ? (payload.categorie_id ? Number(payload.categorie_id) : null)
                      : (cur.categorie_id ?? null),
  };

  if (!merged.nom) throw new Error('Nom requis');
  // Si on choisit *de remplacer* la référence (non null/undefined), s’assurer unicité
  if (merged.reference) {
    merged.reference = ensureUniqueReference(merged.reference);
  }

  STMT_UPDATE.run(merged);
  return getProduit(id);
}

const STMT_DELETE = db.prepare(`DELETE FROM produits WHERE id = ?`);
function supprimerProduit(id) {
  return STMT_DELETE.run(Number(id));
}

// ------------------------------
// (Optionnel) Catégories/familles distinctes des produits *effectifs*
// Utile si tu as besoin d’un endpoint pour construire des filtres.
// ------------------------------
const STMT_CATS_EFFECTIVES = db.prepare(`
  SELECT DISTINCT
    COALESCE(p.categorie_id, f.categorie_id) AS categorie_id,
    c.nom  AS categorie_nom,
    fam.id AS famille_id,
    fam.nom AS famille_nom
  FROM produits p
  LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id
  LEFT JOIN categories  c  ON c.id = COALESCE(p.categorie_id, f.categorie_id)
  LEFT JOIN familles    fam ON fam.id = c.famille_id
  WHERE c.id IS NOT NULL
  ORDER BY fam.nom COLLATE NOCASE, c.nom COLLATE NOCASE
`);
function getCategoriesProduitsEffectives() {
  return STMT_CATS_EFFECTIVES.all();
}

module.exports = {
  // lecture
  getProduits,
  getProduit,

  // écriture
  ajouterProduit,
  modifierProduit,
  supprimerProduit,

  // optionnel
  getCategoriesProduitsEffectives,
};
