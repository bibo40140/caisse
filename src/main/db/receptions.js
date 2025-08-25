// src/main/db/receptions.js
const db = require('./db');
const fs = require('fs');
const path = require('path');

function stocksModuleOn() {
  try {
    const cfgPath = path.join(__dirname, '..', '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return !!(cfg.modules && cfg.modules.stocks);
  } catch (e) {
    console.error('[receptions] lecture config.json échouée :', e);
    // par prudence, on considère OFF si non lisible
    return false;
  }
}

function enregistrerReception(reception) {
  const insertReception = db.prepare(`
    INSERT INTO receptions (fournisseur_id, date, reference)
    VALUES (?, datetime('now'), ?)
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_reception (reception_id, produit_id, quantite, prix_unitaire)
    VALUES (?, ?, ?, ?)
  `);

  // Màj stock + prix
  const updateStockAddOnly = db.prepare(`
    UPDATE produits
      SET stock = stock + ?,
          prix  = COALESCE(?, prix)
    WHERE id = ?
  `);

  const updateStockReplaceThenAdd = db.prepare(`
    UPDATE produits
      SET stock = ?,
          prix  = COALESCE(?, prix)
    WHERE id = ?
  `);

  // Màj prix seul (quand Stocks=OFF)
  const updatePriceOnly = db.prepare(`
    UPDATE produits
      SET prix = COALESCE(?, prix)
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    const stocksOn = stocksModuleOn();

    // Référence BL uniquement s'il y a au moins une quantité reçue (>0)
    const aDesProduitsRecus = reception.lignes.some(l => Number(l.quantite) > 0);
    let referenceBL = null;
    if (aDesProduitsRecus) {
      const datePart = new Date().toISOString().slice(0,10).replace(/-/g,'');
      referenceBL = `BL-${reception.fournisseur_id}-${datePart}-${Date.now()}`;
    }

    const result = insertReception.run(reception.fournisseur_id, referenceBL);
    const receptionId = result.lastInsertRowid;

    for (const ligne of reception.lignes) {
      const quantite = Number(ligne.quantite) || 0;
      const prix = (Number(ligne.prix_unitaire) > 0) ? Number(ligne.prix_unitaire) : null;

      insertLigne.run(receptionId, ligne.produit_id, quantite, prix ?? 0);

      if (!stocksOn) {
        // 👉 stocks OFF : on ne touche pas au stock, on met à jour le prix si fourni
        updatePriceOnly.run(prix, ligne.produit_id);
        continue;
      }

      // stocks ON : logique stock précédente
      if (ligne.stock_corrige !== null && ligne.stock_corrige !== undefined) {
        const newStock = Number(ligne.stock_corrige) + quantite;
        updateStockReplaceThenAdd.run(newStock, prix, ligne.produit_id);
      } else {
        updateStockAddOnly.run(quantite, prix, ligne.produit_id);
      }
    }

    return receptionId;
  });

  return transaction();
}

function getReceptions() {
  return db.prepare(`
    SELECT r.id, r.date, r.reference, f.nom AS fournisseur
    FROM receptions r
    LEFT JOIN fournisseurs f ON r.fournisseur_id = f.id
    ORDER BY r.date DESC
  `).all();
}

function getDetailsReception(receptionId) {
  return db.prepare(`
    SELECT lr.quantite, lr.prix_unitaire, p.nom AS produit, u.nom AS unite
    FROM lignes_reception lr
    JOIN produits p ON lr.produit_id = p.id
    LEFT JOIN unites u ON p.unite_id = u.id
    WHERE lr.reception_id = ?
  `).all(receptionId);
}

module.exports = {
  enregistrerReception,
  getReceptions,
  getDetailsReception
};
