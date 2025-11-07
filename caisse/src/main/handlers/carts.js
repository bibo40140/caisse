// src/main/handlers/carts.js
const { ipcMain } = require('electron');
const db = require('../db/db');

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

const parseMeta = (val) => {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
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
// Statements
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

  const id = String(payload?.id || '').trim();
  if (!id) throw new Error('cart-save failed: id manquant');

  // Normalisation robuste des champs du ticket
  const allowedStatus = new Set(['open', 'closed', 'archived']);
  const status = String(payload?.status || 'open').toLowerCase();
  const safeStatus = allowedStatus.has(status) ? status : 'open';

  const cart = {
    id,
    name: payload?.name || null,
    sale_type: payload?.sale_type || 'adherent',
    adherent_id: toValidFk('adherents', payload?.adherent_id),
    // pas de FK côté prospects (volontaire), on garde un entier positif si fourni
    prospect_id: (Number.isFinite(Number(payload?.prospect_id)) && Number(payload?.prospect_id) > 0)
      ? Number(payload.prospect_id) : null,
    client_email: payload?.client_email || null,
    mode_paiement_id: toValidFk('modes_paiement', payload?.mode_paiement_id),
    meta: payload?.meta ? JSON.stringify(parseMeta(payload.meta)) : null,
    created_at: payload?.created_at || now,
    updated_at: now,
    status: safeStatus,
  };

  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
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
  return rows.map(r => ({ ...r, meta: parseMeta(r.meta) }));
});

ipcMain.handle('cart-load', (e, id) => {
  const cart = db.prepare(`SELECT * FROM carts WHERE id=?`).get(String(id || '').trim());
  if (!cart) return { ok: false, error: 'not_found' };
  const items = db.prepare(`SELECT * FROM cart_items WHERE cart_id=? ORDER BY id ASC`).all(cart.id);
  return { ok: true, cart: { ...cart, meta: parseMeta(cart.meta), items } };
});

ipcMain.handle('cart-close', (e, id) => {
  const cartId = String(id || '').trim();
  db.prepare(`UPDATE carts SET status='closed', updated_at=? WHERE id=?`).run(Date.now(), cartId);
  return { ok: true };
});

ipcMain.handle('cart-delete', (e, id) => {
  const cartId = String(id || '').trim();
  const tx = db.transaction(() => {
    delCartItems.run(cartId);
    db.prepare(`DELETE FROM carts WHERE id=?`).run(cartId);
  });
  tx();
  return { ok: true };
});
