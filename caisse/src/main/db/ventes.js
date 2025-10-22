// src/main/db/ventes.js
// ⚠️ Version alignée avec la nouvelle logique “stock par mouvements”
// - Ici : on écrit la vente + lignes en local, point.
// - PAS de décrément direct de produits.stock (géré par handlers/ventes via stock_movements)
// - PAS d’enqueue d’ops ici (géré par handlers/ventes pour éviter les doublons)

const db = require('./db');
const fs = require('fs');
const path = require('path');

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
 * Crée une vente + lignes en local.
 * - Écrit l'en-tête et les lignes dans SQLite
 * - NE TOUCHE PAS au stock (les mouvements sont gérés par src/main/handlers/ventes.js)
 * - NE fait PAS d’enqueue d’opérations (géré par src/main/handlers/ventes.js)
 */
function enregistrerVente(vente, lignes) {
  if (!vente) throw new Error('vente manquante');
  if (!Array.isArray(lignes) || lignes.length === 0) throw new Error('aucune ligne de vente');

  const useAdherents   = isModuleActive('adherents');
  const modesOn        = isModuleActive('modes_paiement');
  const cotisationsOn  = isModuleActive('cotisations');
  const prospectsOn    = isModuleActive('prospects');

  let saleType = vente.sale_type || (useAdherents ? 'adherent' : 'exterieur');
  if (!useAdherents && saleType === 'adherent') saleType = 'exterieur';
  if (!prospectsOn  && saleType === 'prospect') saleType = useAdherents ? 'adherent' : 'exterieur';

  const adherentId =
    (saleType === 'adherent' && useAdherents && Number.isFinite(Number(vente.adherent_id)))
      ? Number(vente.adherent_id)
      : null;

  const modePaiementId =
    (modesOn && Number.isFinite(Number(vente.mode_paiement_id)))
      ? Number(vente.mode_paiement_id)
      : null;

  const fraisPaiement = modesOn ? Number(vente.frais_paiement || 0) : 0;

  const cotisation =
    (saleType === 'adherent' && useAdherents && cotisationsOn)
      ? Number(vente.cotisation || 0)
      : 0;

  const total       = Number(vente.total || 0);
  const clientEmail = (vente.client_email || null);

  // INSERT header (laisse SQLite remplir date_vente & updated_at)
  const insertVente = db.prepare(`
    INSERT INTO ventes
      (total, adherent_id, date_vente, mode_paiement_id, frais_paiement, cotisation, sale_type, client_email, updated_at)
    VALUES
      (?,     ?,           datetime('now','localtime'), ?,               ?,              ?,          ?,         ?,            datetime('now','localtime'))
  `);

  // INSERT ligne
  const insertLigne = db.prepare(`
    INSERT INTO lignes_vente
      (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent, updated_at)
    VALUES
      (?,        ?,          ?,        ?,    ?,             ?,              datetime('now','localtime'))
  `);

  const tx = db.transaction(() => {
    // En-tête de vente
    const rV = insertVente.run(
      total,
      adherentId,
      modePaiementId,
      fraisPaiement,
      cotisation,
      saleType,
      clientEmail
    );
    const venteId = rV.lastInsertRowid;

    // Lignes de vente (écriture pure, sans stock, sans ops)
    for (const l of lignes) {
      const produitId = Number(l.produit_id);
      const qte       = Number(l.quantite);
      const prix      = Number(l.prix); // total ligne
      const pu        = (l.prix_unitaire != null && l.prix_unitaire !== '') ? Number(l.prix_unitaire) : null;
      const remise    = (l.remise_percent != null && l.remise_percent !== '') ? Number(l.remise_percent) : 0;

      if (!Number.isFinite(produitId) || !Number.isFinite(qte) || qte <= 0) {
        throw new Error('ligne de vente invalide');
      }
      insertLigne.run(venteId, produitId, qte, prix, pu, remise);
    }

    return venteId;
  });

  return tx();
}

/**
 * Historique des ventes (enrichi avec adhérent + mode de paiement + frais + cotisation)
 */
function getHistoriqueVentes(opts = {}) {
  const {
    limit = 50,
    offset = 0,
    search = '',
    dateFrom = null,
    dateTo = null,
    adherentId = null,
  } = opts;

  const params = [];
  let where = '1=1';

  if (search)    { where += ` AND (v.id LIKE ? OR v.client_email LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (dateFrom)  { where += ` AND v.date_vente >= ?`;                     params.push(dateFrom); }
  if (dateTo)    { where += ` AND v.date_vente < ?`;                      params.push(dateTo); }
  if (adherentId != null) { where += ` AND v.adherent_id = ?`;            params.push(Number(adherentId)); }

  return db.prepare(`
    SELECT
      v.id, v.date_vente, v.total, v.adherent_id, v.mode_paiement_id, v.sale_type, v.client_email,
      v.frais_paiement, v.cotisation,
      a.nom AS adherent_nom, a.prenom AS adherent_prenom,
      mp.nom AS mode_paiement_nom
    FROM ventes v
    LEFT JOIN adherents a       ON a.id  = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE ${where}
    ORDER BY v.date_vente DESC, v.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));
}

/**
 * Détail d’une vente (enrichi)
 */
function getDetailsVente(venteId) {
  const header = db.prepare(`
    SELECT v.*,
           a.nom AS adherent_nom, a.prenom AS adherent_prenom,
           mp.nom AS mode_paiement_nom
    FROM ventes v
    LEFT JOIN adherents a       ON a.id = v.adherent_id
    LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
    WHERE v.id = ?
  `).get(Number(venteId));

  const lignes = db.prepare(`
    SELECT lv.*,
           p.nom AS produit_nom,
           p.reference AS produit_reference,
           p.code_barre AS produit_code_barre,
           p.prix AS produit_prix,
           p.unite_id, p.fournisseur_id, p.categorie_id
    FROM lignes_vente lv
    LEFT JOIN produits p ON p.id = lv.produit_id
    WHERE lv.vente_id = ?
    ORDER BY lv.id
  `).all(Number(venteId));

  return { header, lignes };
}

module.exports = { enregistrerVente, getHistoriqueVentes, getDetailsVente };
