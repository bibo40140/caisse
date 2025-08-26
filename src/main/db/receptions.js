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

function enregistrerReception(reception, lignes) {
  if (!reception || !Number.isFinite(Number(reception.fournisseur_id))) {
    throw new Error('fournisseur invalide');
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error('aucune ligne de réception');
  }

  const insertReception = db.prepare(`
    INSERT INTO receptions (fournisseur_id, date, reference)
    VALUES (?, datetime('now','localtime'), ?)
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const ref = reception.reference || (() => {
      const d = new Date(); const pad = n => String(n).padStart(2,'0');
      return `BL-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    })();

    const r = insertReception.run(Number(reception.fournisseur_id), ref);
    const receptionId = r.lastInsertRowid;

    for (const l of lignes) {
      const produitId = Number(l.produit_id);
      const qte = Number(l.quantite);
      const prixU = (l.prix_unitaire != null && l.prix_unitaire !== '') ? Number(l.prix_unitaire) : null;
      insertLigne.run(receptionId, produitId, qte, prixU);

      // Op par ligne
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'reception.line_added',
        entityType: 'ligne_reception',
        entityId: `${receptionId}:${produitId}`,
        payload: {
          ligneRecId: null,
          receptionId,
          fournisseurId: Number(reception.fournisseur_id),
          reference: ref,
          produitId,
          quantite: qte,
          prixUnitaire: prixU,
        },
      });
    }

    // Push immédiat + petit pull
    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(()=>{});
    } catch {}

    return receptionId;
  });

  return tx();
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
    SELECT lr.quantite, lr.prix_unitaire, p.nom AS produit
    FROM lignes_reception lr
    JOIN produits p ON lr.produit_id = p.id
    WHERE lr.reception_id = ?
  `).all(Number(receptionId));

  return { header, lignes };
}

module.exports = { enregistrerReception, getReceptions, getDetailsReception };
