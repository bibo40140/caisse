// src/main/handlers/ventes.js
// Vente robuste (sans colonnes created_at/updated_at dans SQLite)

const db = require('../db/db');
const crypto = require('crypto');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// ————————————————————— Utils —————————————————————
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
      );
}

function stocksModuleOn() {
  try {
    const fs = require('fs');
    const path = require('path');
    const cfgPath = path.join(__dirname, '..', '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return !!(cfg.modules && cfg.modules.stocks);
  } catch { return false; }
}

// Ops queue (synchro)
function enqueueOp({ op_type, entity_type = null, entity_id = null, payload = {} }) {
  const id = uuid();
  db.prepare(`
    INSERT INTO ops_queue (id, device_id, op_type, entity_type, entity_id, payload_json, ack)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    DEVICE_ID || 'unknown-device',
    op_type,
    entity_type,
    entity_id != null ? String(entity_id) : '',
    JSON.stringify(payload || {})
  );
  return id;
}

// Mouvement de stock (local)
function insertStockMovement({ produit_id, delta, reason, ref_type, ref_id, note }) {
  const id = uuid();
  db.prepare(`
    INSERT INTO stock_movements (id, produit_id, delta, reason, ref_type, ref_id, note, device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(produit_id),
    Number(delta),
    String(reason),
    ref_type || null,
    ref_id != null ? String(ref_id) : null,
    note || null,
    DEVICE_ID || 'unknown-device'
  );
  return id;
}

// ——————————————————— Normalisation ———————————————————
function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input.map(l => {
    const produit_id     = Number(l.produit_id ?? l.product_id ?? l.id);
    const quantite       = Number(l.quantite ?? l.qty ?? l.qte ?? 0);
    const prix           = Number(l.prix ?? l.price ?? l.total ?? 0);
    const prix_unitaire  = (l.prix_unitaire == null || l.prix_unitaire === '')
      ? null : Number(l.prix_unitaire);
    const remise_percent = Number(l.remise_percent ?? l.remise ?? 0);
    return { produit_id, quantite, prix, prix_unitaire, remise_percent };
  }).filter(l =>
    Number.isFinite(l.produit_id) && l.produit_id > 0 &&
    Number.isFinite(l.quantite)   && l.quantite   > 0
  );
}

function normalizeMeta(meta = {}) {
  return {
    total:            Number(meta.total ?? 0),
    adherent_id:      meta.adherent_id != null ? Number(meta.adherent_id) : null,
    mode_paiement_id: meta.mode_paiement_id != null ? Number(meta.mode_paiement_id) : null,
    sale_type:        String(meta.sale_type || 'adherent'),
    client_email:     meta.client_email ?? null,
    cotisation:       meta.cotisation != null ? Number(meta.cotisation) : null,
    frais_paiement:   meta.frais_paiement != null ? Number(meta.frais_paiement) : null,
  };
}

// ——————————————————— Handler principal ———————————————————
function registerVentesHandlers(ipcMain) {
  ipcMain.handle('enregistrer-vente', (_event, payload = {}) => {
    try {
      const lignes = normalizeLignes(payload.lignes || payload.items || []);
      const meta   = normalizeMeta(payload.meta || {});
      if (lignes.length === 0) throw new Error('aucune ligne de vente');

      const doStocks = stocksModuleOn();

      // Préparations SQL (sans created_at/updated_at)
      const insVente = db.prepare(`
        INSERT INTO ventes (total, adherent_id, mode_paiement_id, sale_type, client_email)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insLigne = db.prepare(`
        INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const selStock = db.prepare(`SELECT stock FROM produits WHERE id = ?`);
      const updProd  = db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`);

      // 1) Écrire la vente + lignes
      const venteId = db.transaction(() => {
        const r = insVente.run(
          meta.total,
          meta.adherent_id,
          meta.mode_paiement_id,
          meta.sale_type,
          meta.client_email
        );
        const id = r.lastInsertRowid;

        for (const l of lignes) {
          insLigne.run(id, l.produit_id, l.quantite, l.prix, l.prix_unitaire, l.remise_percent);

          // Mouvement (-qte)
          insertStockMovement({
            produit_id: l.produit_id,
            delta: -Math.abs(Number(l.quantite || 0)),
            reason: 'sale',
            ref_type: 'vente',
            ref_id: id,
            note: null
          });

          // Compat : décrémenter aussi produits.stock si le module stock est actif
          if (doStocks) {
            const row  = selStock.get(l.produit_id);
            const cur  = Number(row?.stock || 0);
            const next = cur - Math.abs(Number(l.quantite || 0));
            updProd.run(next, l.produit_id);
          }
        }

        // champs optionnels
        try {
          if (meta.frais_paiement != null) {
            db.prepare(`UPDATE ventes SET frais_paiement = ? WHERE id = ?`).run(meta.frais_paiement, id);
          }
        } catch {}
        try {
          if (meta.cotisation != null) {
            db.prepare(`UPDATE ventes SET cotisation = ? WHERE id = ?`).run(meta.cotisation, id);
          }
        } catch {}

        return id;
      })();

      // 2) Enfiler les ops (best effort)
      try {
        enqueueOp({
          op_type: 'sale.created',
          entity_type: 'vente',
          entity_id: venteId,
          payload: {
            venteId,
            total: meta.total,
            adherentId: meta.adherent_id,
            modePaiementId: meta.mode_paiement_id,
            saleType: meta.sale_type,
            clientEmail: meta.client_email,
            fraisPaiement: meta.frais_paiement,
            cotisation: meta.cotisation
          }
        });

        for (const l of lignes) {
          enqueueOp({
            op_type: 'sale.line_added',
            entity_type: 'ligne_vente',
            entity_id: `${venteId}:${l.produit_id}`,
            payload: {
              venteId,
              produitId: l.produit_id,
              quantite: l.quantite,
              prix: l.prix,
              prixUnitaire: l.prix_unitaire,
              remisePercent: l.remise_percent
            }
          });
        }
      } catch (e) {
        console.warn('[ventes] WARN enqueue ops failed:', e?.message || e);
      }

      // 3) Push immédiat (non bloquant)
      try { require('../sync').pushOpsNow?.(DEVICE_ID)?.catch(()=>{}); } catch {}

      return { ok: true, id: venteId };
    } catch (e) {
      console.error('[ventes] enregistrer-vente ERROR:', e?.message || e);
      throw e;
    }
  });
}

module.exports = registerVentesHandlers;
