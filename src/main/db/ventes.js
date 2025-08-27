// src/main/db/ventes.js
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
  } catch { return false; }
}

/**
 * Crée une vente + lignes en local (sans toucher au stock)
 * et enfile les ops de vente (le serveur créera le mouvement de stock).
 */
function enregistrerVente(vente, lignes) {
  if (!vente) throw new Error('vente manquante');
  if (!Array.isArray(lignes) || lignes.length === 0) throw new Error('aucune ligne de vente');

  const useAdherents = isModuleActive('adherents');

  const insertVente = db.prepare(`
    INSERT INTO ventes
      (total, adherent_id, date_vente, mode_paiement_id, frais_paiement, sale_type, client_email, updated_at)
    VALUES
      (?, ?, datetime('now','localtime'), ?, ?, ?, ?, datetime('now','localtime'))
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_vente
      (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `);

  const tx = db.transaction(() => {
    const saleType = vente.sale_type || (useAdherents ? 'adherent' : 'exterieur');
  const adherentId = useAdherents ? (Number(vente.adherent_id) || null) : null;
  // ⬇️ d’abord faire confiance au payload, sinon déduire
    const rV = insertVente.run(
      Number(vente.total || 0),
      adherentId,
      (vente.mode_paiement_id ?? null),
      Number(vente.frais_paiement || 0),
      saleType,
      (vente.client_email || null)
    );
    const venteId = rV.lastInsertRowid;

    // Op header
    enqueueOp({
      deviceId: DEVICE_ID,
      opType: 'sale.created',
      entityType: 'vente',
      entityId: String(venteId),
      payload: {
        venteId,
        total: Number(vente.total || 0),
        adherentId,
        modePaiementId: (vente.mode_paiement_id ?? null),
        fraisPaiement: Number(vente.frais_paiement || 0),
        saleType,
        clientEmail: (vente.client_email || null),
      },
    });

    for (const l of lignes) {
      const produitId = Number(l.produit_id);
      const qte = Number(l.quantite);
      const prix = Number(l.prix);
      const pu = (l.prix_unitaire != null && l.prix_unitaire !== '') ? Number(l.prix_unitaire) : null;
      const remise = (l.remise_percent != null && l.remise_percent !== '') ? Number(l.remise_percent) : 0;

      if (!Number.isFinite(produitId) || !Number.isFinite(qte) || qte <= 0) {
        throw new Error('ligne de vente invalide');
      }

      const rL = insertLigne.run(venteId, produitId, qte, prix, pu, remise);
      const ligneId = rL.lastInsertRowid;

      // Op ligne
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'sale.line_added',
        entityType: 'ligne_vente',
        entityId: String(ligneId),
        payload: {
          ligneId,
          venteId,
          produitId,
          quantite: qte,
          prix,
          prixUnitaire: pu,
          remisePercent: remise,
        },
      });
    }

    // Push immédiat + petit pull (si disponible)
    try {
      const { pushOpsNow } = require('../sync');
      if (typeof pushOpsNow === 'function') pushOpsNow(DEVICE_ID).catch(()=>{});
    } catch {}

    return venteId;
  });

  return tx();
}

function getHistoriqueVentes(opts = {}) {
  const { limit=50, offset=0, search='', dateFrom=null, dateTo=null, adherentId=null } = opts;
  const p=[]; let w='1=1';
  if (search)   { w+=` AND (v.id LIKE ? OR v.client_email LIKE ?)`; p.push(`%${search}%`,`%${search}%`); }
  if (dateFrom) { w+=` AND v.date_vente >= ?`; p.push(dateFrom); }
  if (dateTo)   { w+=` AND v.date_vente < ?`;  p.push(dateTo); }
  if (adherentId!=null) { w+=` AND v.adherent_id = ?`; p.push(Number(adherentId)); }

  return db.prepare(`
    SELECT
      v.id, v.date_vente, v.total, v.adherent_id, v.mode_paiement_id,
      v.frais_paiement, v.sale_type, v.client_email,
      a.nom  AS adherent_nom,
      a.prenom AS adherent_prenom,
      mp.nom AS mode_paiement_nom
    FROM ventes v
    LEFT JOIN adherents a       ON a.id = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE ${w}
    ORDER BY v.date_vente DESC, v.id DESC
    LIMIT ? OFFSET ?
  `).all(...p, Number(limit), Number(offset));
}

function getDetailsVente(venteId) {
  const header = db.prepare(`
    SELECT
      v.*,
      a.nom  AS adherent_nom,
      a.prenom AS adherent_prenom,
      mp.nom AS mode_paiement_nom
    FROM ventes v
    LEFT JOIN adherents a       ON a.id = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE v.id = ?
  `).get(Number(venteId));

  const lignes = db.prepare(`
    SELECT lv.*, p.nom AS produit_nom, p.reference AS produit_reference,
           p.code_barre AS produit_code_barre, p.prix AS produit_prix,
           p.unite_id, p.fournisseur_id, p.categorie_id
    FROM lignes_vente lv
    LEFT JOIN produits p ON p.id = lv.produit_id
    WHERE lv.vente_id = ?
    ORDER BY lv.id
  `).all(Number(venteId));

  return { header, lignes };
}

module.exports = { enregistrerVente, getHistoriqueVentes, getDetailsVente };
