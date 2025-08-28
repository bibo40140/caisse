// src/main/handlers/carts.js
const { ipcMain } = require('electron');
const db = require('../db/db');

// ─────────────────────────────────────────────────────────────
// Schéma (idempotent)
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS carts (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    sale_type        TEXT NOT NULL DEFAULT 'adherent',
    adherent_id      INTEGER,
    prospect_id      INTEGER,
    client_email     TEXT,
    mode_paiement_id INTEGER,
    meta             TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY (adherent_id)      REFERENCES adherents(id),
    FOREIGN KEY (mode_paiement_id) REFERENCES modes_paiement(id)
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id         TEXT NOT NULL,
    produit_id      INTEGER,
    nom             TEXT,
    fournisseur_nom TEXT,
    unite           TEXT,
    prix            REAL,
    quantite        REAL,
    remise_percent  REAL,
    type            TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (cart_id)    REFERENCES carts(id)     ON DELETE CASCADE,
    FOREIGN KEY (produit_id) REFERENCES produits(id)  ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
`);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const existsId = (table, id) => {
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  const row = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(n);
  return !!row;
};

const toValidFk = (table, v) => {
  const id = Number(v);
  if (!Number.isFinite(id) || id <= 0) return null;
  return existsId(table, id) ? id : null;
};

// Nettoie un item pour respecter les FKs
const sanitizeItem = (raw) => {
  const it = { ...raw };

  it.type = it.type || 'produit';

  // produit_id: seulement pour type "produit" ET si l'id existe
  if (it.type !== 'produit') {
    it.produit_id = null;
  } else {
    const prodId = Number(it.produit_id);
    it.produit_id = (Number.isFinite(prodId) && prodId > 0 && existsId('produits', prodId)) ? prodId : null;
  }

  it.prix           = Number(it.prix || 0);
  it.quantite       = Number(it.quantite || 0);
  it.remise_percent = Number(it.remise_percent || 0);

  it.nom             = it.nom || null;
  it.fournisseur_nom = it.fournisseur_nom || null;
  it.unite           = it.unite || null;

  return it;
};

// ─────────────────────────────────────────────────────────────
const upsertCart = db.prepare(`
  INSERT INTO carts (id, name, sale_type, adherent_id, prospect_id, client_email, mode_paiement_id, meta, created_at, updated_at, status)
  VALUES (@id, @name, @sale_type, @adherent_id, @prospect_id, @client_email, @mode_paiement_id, @meta, @created_at, @updated_at, @status)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,
    sale_type=excluded.sale_type,
    adherent_id=excluded.adherent_id,
    prospect_id=excluded.prospect_id,
    client_email=excluded.client_email,
    mode_paiement_id=excluded.mode_paiement_id,
    meta=excluded.meta,
    updated_at=excluded.updated_at,
    status=excluded.status
`);

const delCartItems = db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`);
const insCartItem  = db.prepare(`
  INSERT INTO cart_items (cart_id, produit_id, nom, fournisseur_nom, unite, prix, quantite, remise_percent, type, created_at, updated_at)
  VALUES (@cart_id, @produit_id, @nom, @fournisseur_nom, @unite, @prix, @quantite, @remise_percent, @type, @created_at, @updated_at)
`);

// ─────────────────────────────────────────────────────────────
// IPC
// ─────────────────────────────────────────────────────────────
ipcMain.handle('cart-save', (e, payload) => {
  const now = Date.now();

  // Normalisation robuste des champs du ticket
  const cart = {
    id: String(payload.id),
    name: payload.name || null,
    sale_type: payload.sale_type || 'adherent',
    adherent_id: toValidFk('adherents', payload.adherent_id),
    // pas de FK côté prospects (volontaire), on garde un entier positif si fourni
    prospect_id: (Number.isFinite(Number(payload.prospect_id)) && Number(payload.prospect_id) > 0)
      ? Number(payload.prospect_id) : null,
    client_email: payload.client_email || null,
    mode_paiement_id: toValidFk('modes_paiement', payload.mode_paiement_id),
    meta: payload.meta ? JSON.stringify(payload.meta) : null,
    created_at: payload.created_at || now,
    updated_at: now,
    status: payload.status || 'open',
  };

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.map(sanitizeItem);

  const tx = db.transaction(() => {
    try {
      upsertCart.run(cart);
      delCartItems.run(cart.id);

      for (const it of items) {
        try {
          insCartItem.run({
            cart_id: cart.id,
            produit_id: it.produit_id, // peut être NULL
            nom: it.nom,
            fournisseur_nom: it.fournisseur_nom,
            unite: it.unite,
            prix: it.prix,
            quantite: it.quantite,
            remise_percent: it.remise_percent,
            type: it.type,
            created_at: now,
            updated_at: now,
          });
        } catch (err) {
          console.error('[cart-save] insert item FAILED:', {
            cart_id: cart.id,
            item: it,
            error: err && err.message
          });
          throw err;
        }
      }
    } catch (err) {
      console.error('[cart-save] FAILED:', { cart, items, error: err && err.message });
      throw err;
    }
  });

  try {
    tx();
  } catch (err) {
    throw new Error(`cart-save failed: ${err.message}`);
  }

  return { ok: true, id: cart.id };
});

ipcMain.handle('cart-list', (e, { status = 'open', limit = 50 } = {}) => {
  const rows = db.prepare(
    `SELECT * FROM carts WHERE status=? ORDER BY updated_at DESC LIMIT ?`
  ).all(status, limit);
  return rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
});

ipcMain.handle('cart-load', (e, id) => {
  const cart = db.prepare(`SELECT * FROM carts WHERE id=?`).get(id);
  if (!cart) return { ok: false, error: 'not_found' };
  const items = db.prepare(`SELECT * FROM cart_items WHERE cart_id=? ORDER BY id ASC`).all(id);
  return { ok: true, cart: { ...cart, meta: cart.meta ? JSON.parse(cart.meta) : null, items } };
});

ipcMain.handle('cart-close', (e, id) => {
  db.prepare(`UPDATE carts SET status='closed', updated_at=? WHERE id=?`).run(Date.now(), id);
  return { ok: true };
});

ipcMain.handle('cart-delete', (e, id) => {
  const tx = db.transaction(() => {
    delCartItems.run(id);
    db.prepare(`DELETE FROM carts WHERE id=?`).run(id);
  });
  tx();
  return { ok: true };
});
