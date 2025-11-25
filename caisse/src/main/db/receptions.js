// src/main/db/receptions.js
const db = require('./db');
const fs = require('fs');
const path = require('path');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function isModuleActive(moduleName) {
  try {
    const configPath = path.join(__dirname, '..', '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return !!(cfg && cfg.modules && cfg.modules[moduleName] === true);
  } catch {
    return false;
  }
}

/**
 * Normalise une ligne brute de réception
 * attend au minimum: produit_id, quantite
 * optionnels: prix_unitaire, stock_corrige
 */
function normalizeLine(l) {
  const produit_id = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
  const quantite   = Number(l.quantite ?? l.qty ?? l.qte ?? 0);

  const puRaw = l.prix_unitaire ?? l.pu ?? l.price;
  const prix_unitaire =
    (puRaw === '' || puRaw == null || Number.isNaN(Number(puRaw))) ? null : Number(puRaw);

  const scRaw = l.stock_corrige ?? l.stockCorrige;
  const stock_corrige =
    (scRaw === '' || scRaw == null || Number.isNaN(Number(scRaw))) ? null : Number(scRaw);

  return { produit_id, quantite, prix_unitaire, stock_corrige };
}

/**
 * Enregistre une réception (header + lignes), met à jour le stock local,
 * et enfile des opérations de synchro pour Neon.
 *
 * @param {{fournisseur_id:number, reference?:string|null}} reception
 * @param {Array} lignes
 * @returns {number} receptionId (SQLite)
 */
function enregistrerReception(reception, lignes) {
  // ✅ Accepter fournisseur_id = null (pas de fournisseur) OU un nombre > 0
  const fid = reception?.fournisseur_id;
  if (!reception) {
    throw new Error('reception manquante');
  }
  // Si fid n'est pas null, il doit être un nombre > 0
  if (fid !== null && (!Number.isFinite(Number(fid)) || Number(fid) <= 0)) {
    throw new Error('reception.fournisseur_id invalide (doit être null ou > 0)');
  }
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error('aucune ligne de réception');
  }

  const stocksOn = isModuleActive('stocks');

  // Statements
  const insReception = db.prepare(`
    INSERT INTO receptions (fournisseur_id, date, reference, updated_at)
    VALUES (?, datetime('now','localtime'), ?, datetime('now','localtime'))
  `);

  const insLigne = db.prepare(`
    INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `);

  // Deux modes pour le stock local :
  // - si stock_corrige fourni : on SET = stock_corrige + quantite
  // - sinon : on INCREMENTE += quantite
  const setStock = stocksOn
    ? db.prepare(`UPDATE produits SET stock = ? WHERE id = ?`)
    : null;
  const incStock = stocksOn
    ? db.prepare(`UPDATE produits SET stock = stock + ? WHERE id = ?`)
    : null;

  const tx = db.transaction(() => {
    // Header
    const rHead = insReception.run(
      Number(reception.fournisseur_id),
      reception.reference ?? null
    );
    const receptionId = rHead.lastInsertRowid;

    // Lignes
    for (const raw of lignes) {
      const { produit_id, quantite, prix_unitaire, stock_corrige } = normalizeLine(raw);
      if (!Number.isFinite(produit_id) || produit_id <= 0 || !Number.isFinite(quantite) || quantite <= 0) {
        throw new Error('ligne de réception invalide');
      }

      const rL = insLigne.run(receptionId, produit_id, quantite, prix_unitaire);
      const ligneRecId = rL.lastInsertRowid;

      // Stock local immédiat
      if (stocksOn) {
        if (stock_corrige != null) {
          const desired = stock_corrige + quantite;
          setStock.run(desired, produit_id);
        } else {
          incStock.run(quantite, produit_id);
        }
      }


      // 🔁 Mise à jour du PRIX produit si un PU a été fourni
      if (prix_unitaire != null) {
        db.prepare(`
          UPDATE produits
             SET prix = ?,
                 updated_at = datetime('now','localtime')
           WHERE id = ?
        `).run(Number(prix_unitaire), produit_id);

        // Enqueue l'op de mise à jour produit pour Neon
        enqueueOp({
          deviceId: DEVICE_ID,
          opType: 'product.updated',
          entityType: 'produit',
          entityId: String(produit_id),
          payload: { id: produit_id, prix: Number(prix_unitaire) }
        });
      }

      // 🔥 Récupérer les UUIDs et la référence du produit pour envoyer au serveur
      const receptionUuid = db.prepare('SELECT remote_uuid FROM receptions WHERE id = ?').pluck().get(receptionId) || null;
      const fournisseurUuid = db.prepare('SELECT remote_uuid FROM fournisseurs WHERE id = ?').pluck().get(Number(reception.fournisseur_id)) || null;
      const produitRow = db.prepare('SELECT remote_uuid, reference FROM produits WHERE id = ?').get(produit_id);
      const produitUuid = produitRow?.remote_uuid || null;
      const produitReference = produitRow?.reference || null;

      console.log('[receptions] UUIDs récupérés:', {
        receptionId, receptionUuid,
        fournisseurId: Number(reception.fournisseur_id), fournisseurUuid,
        produitId: produit_id, produitUuid, produitReference
      });

      // Enqueue op pour Neon (mouvement + ligne + header si besoin côté serveur)
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'reception.line_added',
        entityType: 'ligne_reception',
        entityId: String(`${receptionId}:${produit_id}`),
        payload: {
          // IDs locaux (pour debug)
          receptionId,
          fournisseurId: Number(reception.fournisseur_id),
          ligneRecId,
          produitId: produit_id,

          // UUIDs pour Postgres
          receptionUuid,
          fournisseurUuid,
          produitUuid,

          // Référence du produit (fallback si UUID absent)
          produitReference,

          // Données métier
          reference: reception.reference ?? null,
          quantite,
          prixUnitaire: prix_unitaire != null ? Number(prix_unitaire) : null,
          stockCorrige: stock_corrige != null ? Number(stock_corrige) : null,
        },
      });
    }

    // Push best-effort tout de suite
    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(() => {});
    } catch {}

    return receptionId;
  });

  return tx();
}

function getReceptions(opts = {}) {
  const { limit = 100, offset = 0 } = opts;
  return db.prepare(`
    SELECT r.id, r.date, r.reference, r.fournisseur_id, f.nom AS fournisseur
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
    SELECT lr.*, p.nom AS produit, p.unite_id, u.nom AS unite
    FROM lignes_reception lr
    LEFT JOIN produits p ON p.id = lr.produit_id
    LEFT JOIN unites u   ON u.id = p.unite_id
    WHERE lr.reception_id = ?
    ORDER BY lr.id
  `).all(Number(receptionId));

  return { header, lignes };
}

module.exports = {
  enregistrerReception,
  getReceptions,
  getDetailsReception,
};
