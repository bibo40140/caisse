// src/main/db/receptions.js
// ⚠️ Version alignée “stock par mouvements”
// - Ici : on écrit la réception + lignes en SQLite, point.
// - PAS de mise à jour directe de produits.stock (géré par handlers/receptions via stock_movements)
// - PAS d’enqueue d’opérations (géré par handlers/receptions pour éviter les doublons)

const db = require('./db');

/** Petit helper pour avoir un timestamp SQLite local */
function nowLocal() {
  return `datetime('now','localtime')`;
}

/**
 * Enregistre une réception + lignes.
 * @param {Object} reception - { fournisseur_id, reference? , lignes? }
 * @param {Array}  lignes    - [{ produit_id, quantite, prix_unitaire? }, ...]
 * @returns {number} receptionId
 */
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

  const tx = db.transaction(() => {
    // Référence auto si absente (ex: BL-YYYYMMDD-HHMMSS)
    const ref = referenceIn || (() => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `BL-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    })();

    const r = insertReception.run(fournisseurId, ref);
    const receptionId = r.lastInsertRowid;

    for (const l of lignes) {
      const produitId = Number(l.produit_id ?? l.id);
      const qte       = Number(l.quantite ?? l.qty ?? l.qte ?? 0);
      const prixU     = (l.prix_unitaire != null && l.prix_unitaire !== '') ? Number(l.prix_unitaire) : null;

      if (!Number.isFinite(produitId) || !Number.isFinite(qte) || qte <= 0) {
        throw new Error('ligne de réception invalide');
      }

      insertLigne.run(receptionId, produitId, qte, prixU);
    }

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
    SELECT
      lr.produit_id,
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
