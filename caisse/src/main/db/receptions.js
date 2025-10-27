// src/main/db/receptions.js
const db = require('./db');
const fs = require('fs');
const path = require('path');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function stocksModuleOn() {
  try {
    const cfgPath = path.join(__dirname, '..', '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return !!(cfg.modules && cfg.modules.stocks);
  } catch { return false; }
}

function nowLocal() { return `datetime('now','localtime')`; }

function enregistrerReception(reception, lignes) {
  // compat : certaines UIs envoient tout dans reception.lignes
  if (!Array.isArray(lignes) || lignes.length === 0) {
    lignes = Array.isArray(reception?.lignes) ? reception.lignes : [];
  }
  if (!reception || !Number.isFinite(Number(reception.fournisseur_id || reception.fournisseurId))) {
    throw new Error('fournisseur invalide');
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error('aucune ligne de réception');
  }

  const fournisseurId = Number(reception.fournisseur_id || reception.fournisseurId);
  const referenceIn   = (reception.reference || null);

  const insertReception = db.prepare(`
    INSERT INTO receptions (fournisseur_id, date, reference, updated_at)
    VALUES (?, ${nowLocal()}, ?, ${nowLocal()})
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire, updated_at)
    VALUES (?, ?, ?, ?, ${nowLocal()})
  `);

  const selStock = db.prepare(`SELECT stock, prix FROM produits WHERE id = ?`);
  const updProd  = db.prepare(`
    UPDATE produits
       SET stock = ?,
           prix  = COALESCE(?, prix),
           updated_at = ${nowLocal()}
     WHERE id = ?
  `);

  const tx = db.transaction(() => {
    const ref = referenceIn || (() => {
      const d = new Date(); const pad = n => String(n).padStart(2,'0');
      return `BL-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    })();

    const r = insertReception.run(fournisseurId, ref);
    const receptionId = r.lastInsertRowid;

    const doStocks = stocksModuleOn();

    for (const l of lignes) {
      const produitId    = Number(l.produit_id);
      const qte          = Number(l.quantite || 0);
      const prixU        = (l.prix_unitaire != null && l.prix_unitaire !== '') ? Number(l.prix_unitaire) : null;
      const stockCorrige = (l.stock_corrige !== undefined && l.stock_corrige !== null && l.stock_corrige !== '')
        ? Number(l.stock_corrige) : null;

      if (!Number.isFinite(produitId)) throw new Error('ligne reception: produit invalide');

      // 1) Enregistrer la ligne de BL
      insertLigne.run(receptionId, produitId, qte, prixU);

      // 2) MAJ stock local selon TA règle
      if (doStocks) {
        const row = selStock.get(produitId);
        const current = Number(row?.stock || 0);

        let newStock;
        if (stockCorrige !== null && Number.isFinite(stockCorrige)) {
          // règle demandée : stock_corrigé + quantité
          newStock = stockCorrige + (Number.isFinite(qte) ? qte : 0);
        } else {
          // sinon : stock actuel + quantité
          newStock = current + (Number.isFinite(qte) ? qte : 0);
        }

        const newPrix = (prixU !== null && Number.isFinite(prixU)) ? prixU : null;
        updProd.run(newStock, newPrix, produitId);
      }

      // 3) Enqueue op (utile si tu rebrancheras Neon plus tard)
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'reception.line_added',
        entityType: 'ligne_reception',
        entityId: `${receptionId}:${produitId}`,
        payload: {
          ligneRecId: null,
          receptionId,
          fournisseurId,
          reference: ref,
          produitId,
          quantite: qte,
          prixUnitaire: prixU,
          stockCorrige: stockCorrige,
        },
      });
    }

    // push immédiat si sync dispo (ne casse rien en local)
    try { require('../sync').pushOpsNow?.(DEVICE_ID)?.catch(()=>{}); } catch {}
   return receptionId;
  });

  const receptionId = tx();

  try {
    const { pushOpsNow } = require('../sync');
    if (typeof pushOpsNow === 'function') {
      setTimeout(() => { pushOpsNow(DEVICE_ID).catch(() => {}); }, 0);
    }
  } catch {}

  return receptionId;
}

function getReceptions({ limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT r.*, f.nom AS fournisseur
    FROM receptions r
    LEFT JOIN fournisseurs f ON f.id = r.fournisseur_id
    ORDER BY r.date DESC, r.id DESC
    LIMIT ? OFFSET ?
  `).all(Number(limit), Number(offset));
}

function getDetailsReception(receptionId) {
  const header = db.prepare(`
    SELECT r.*, f.nom AS fournisseur
    FROM receptions r
    LEFT JOIN fournisseurs f ON f.id = r.fournisseur_id
    WHERE r.id = ?
  `).get(Number(receptionId));

  const lignes = db.prepare(`
    SELECT
      lr.quantite,
      lr.prix_unitaire,
      p.nom AS produit,
      u.nom AS unite
    FROM lignes_reception lr
    JOIN produits p ON lr.produit_id = p.id
    LEFT JOIN unites u ON u.id = p.unite_id
    WHERE lr.reception_id = ?
    ORDER BY lr.id
  `).all(Number(receptionId));

  return { header, lignes };
}

module.exports = { enregistrerReception, getReceptions, getDetailsReception };
