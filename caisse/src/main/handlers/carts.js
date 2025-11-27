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

  // On accepte l'adherent_id tel quel (pas de validation FK)
  // car l'adhérent peut ne pas être encore synchronisé localement
  const adherentId = (Number.isFinite(Number(payload?.adherent_id)) && Number(payload?.adherent_id) > 0)
    ? Number(payload.adherent_id) : null;
  
  if (adherentId) {
    console.log('[cart-save] Adhérent ID:', adherentId);
  }

  const cart = {
    id,
    name: payload?.name || null,
    sale_type: payload?.sale_type || 'adherent',
    adherent_id: adherentId,
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

  // Préparer les statements dans le handler pour éviter les problèmes avec le proxy DB
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

  const insCartItem = db.prepare(`
    INSERT INTO cart_items (cart_id, produit_id, nom, fournisseur_nom, unite, prix, quantite, remise_percent, type, created_at, updated_at)
    VALUES (@cart_id, @produit_id, @nom, @fournisseur_nom, @unite, @prix, @quantite, @remise_percent, @type, @created_at, @updated_at)
  `);

  const tx = db.transaction(() => {
    try {
      console.log('[cart-save] Insertion du cart:', { id: cart.id, name: cart.name, status: cart.status, adherent_id: cart.adherent_id });
      upsertCart.run(cart);
      delCartItems.run(cart.id);

      for (const it of items) {
        try {
          console.log('[cart-save] Insertion item:', { produit_id: it.produit_id, nom: it.nom, type: it.type });
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
            error: err.message,
            code: err.code
          });
          throw err;
        }
      }
    } catch (err) {
      console.error('[cart-save] FAILED:', { 
        cart: { id: cart.id, adherent_id: cart.adherent_id }, 
        error: err.message,
        code: err.code 
      });
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
  // Debug: voir TOUS les paniers
  const allCarts = db.prepare(`SELECT id, name, status FROM carts ORDER BY updated_at DESC LIMIT 10`).all();
  console.log(`[cart-list] Total paniers dans la base:`, allCarts.length, allCarts);
  
  const rows = db.prepare(
    `SELECT * FROM carts WHERE status=? ORDER BY updated_at DESC LIMIT ?`
  ).all(status, limit);
  console.log(`[cart-list] Trouvé ${rows.length} paniers avec status="${status}"`);
  if (rows.length > 0) {
    console.log('[cart-list] Exemple:', { id: rows[0].id, name: rows[0].name, status: rows[0].status });
  }
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
