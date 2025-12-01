// src/main/db/ventes.js
const db = require('./db');
const fs = require('fs');
const path = require('path');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');
const { createStockMovement } = require('./stock');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function isModuleActive(moduleName) {
  try {
    const configPath = path.join(__dirname, '..', '..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return !!(cfg && cfg.modules && cfg.modules[moduleName] === true);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Écriture d'une vente                                               */
/* ------------------------------------------------------------------ */
/**
 * Convention stockage lignes_vente :
 *  - prix          = TOTAL de la ligne (PU appliqué × quantité)
 *  - prix_unitaire = PU appliqué (après remise/marge)
 *  - quantite      = quantité vendue
 */
function enregistrerVente(vente, lignes) {
  if (!vente) throw new Error('vente manquante');
  if (!Array.isArray(lignes) || lignes.length === 0) throw new Error('aucune ligne de vente');

  const useAdherents   = isModuleActive('adherents');
  const stocksOn       = isModuleActive('stocks');
  const modesOn        = isModuleActive('modes_paiement');
  const cotisationsOn  = isModuleActive('cotisations');
  const prospectsOn    = isModuleActive('prospects');

  // Sale type cohérent
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

  const acompte = Number(vente.acompte || 0);

  // total (produits) envoyé par le handler
  const total = Number(vente.total || 0);
  const clientEmail = (vente.client_email || null);

  // 🔧 Si mode_paiement_id est NULL et que le module est désactivé,
  // on doit gérer la contrainte FK proprement
  let finalModePaiementId = modePaiementId;
  
  if (modePaiementId === null && !modesOn) {
    // Module désactivé : on laisse NULL et on accepte que ça puisse échouer si FK stricte
    // La vraie solution serait de rendre la FK nullable dans le schéma
    finalModePaiementId = null;
  } else if (modePaiementId === null && modesOn) {
    // Module activé mais pas de mode sélectionné : prendre le premier disponible
    const firstMode = db.prepare(`SELECT id FROM modes_paiement WHERE id > 0 ORDER BY id LIMIT 1`).get();
    finalModePaiementId = firstMode?.id || null;
  }
  
  console.log('[ventes] Mode paiement final:', finalModePaiementId, 'modesOn:', modesOn);

  // Stmts
  const insertVente = db.prepare(`
    INSERT INTO ventes
      (total, adherent_id, date_vente, mode_paiement_id, frais_paiement, cotisation, acompte, sale_type, client_email, updated_at)
    VALUES
      (?,     ?,           datetime('now','localtime'), ?,               ?,              ?,          ?,       ?,         ?,            datetime('now','localtime'))
  `);

  const insertLigne = db.prepare(`
    INSERT INTO lignes_vente
      (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent, updated_at)
    VALUES
      (?,        ?,          ?,        ?,    ?,             ?,              datetime('now','localtime'))
  `);

  const tx = db.transaction(() => {
    // HEADER
    console.log('[ventes] Inserting vente with:', {
      total,
      adherentId,
      finalModePaiementId,
      saleType,
      clientEmail
    });
    
    // Vérifier que l'adherent existe si on en fournit un
    if (adherentId !== null) {
      const adhExists = db.prepare(`SELECT id FROM adherents WHERE id = ?`).get(adherentId);
      if (!adhExists) {
        throw new Error(`Adhérent ID ${adherentId} n'existe pas en local - synchronisation requise`);
      }
    }
    
    // Vérifier que le mode de paiement existe si on en fournit un
    if (finalModePaiementId !== null && finalModePaiementId !== undefined) {
      const modeExists = db.prepare(`SELECT id FROM modes_paiement WHERE id = ?`).get(finalModePaiementId);
      if (!modeExists) {
        console.warn(`[ventes] Mode paiement ID ${finalModePaiementId} n'existe pas, utilisation de NULL`);
        finalModePaiementId = null;
      }
    }
    
    // Si module modes_paiement désactivé et finalModePaiementId=null, désactiver temporairement les FK
    const needDisableFK = !modesOn && finalModePaiementId === null;
    if (needDisableFK) {
      db.prepare('PRAGMA foreign_keys = OFF').run();
    }
    
    const rV = insertVente.run(
      total,
      adherentId,
      finalModePaiementId,
      fraisPaiement,
      cotisation,
      acompte,
      saleType,
      clientEmail
    );
    const venteId = rV.lastInsertRowid;
    console.log('[ventes] Vente inserted with ID:', venteId);
    
    if (needDisableFK) {
      db.prepare('PRAGMA foreign_keys = ON').run();
    }

    // 🔥 Récupérer les remote_uuid pour adherent et mode_paiement
    let adherentUuid = null;
    let modePaiementUuid = null;

    if (adherentId) {
      const adhRow = db.prepare(`SELECT remote_uuid FROM adherents WHERE id = ?`).get(adherentId);
      adherentUuid = adhRow?.remote_uuid || null;
    }

    if (finalModePaiementId) {
      const mpRow = db.prepare(`SELECT remote_uuid FROM modes_paiement WHERE id = ?`).get(finalModePaiementId);
      modePaiementUuid = mpRow?.remote_uuid || null;
    }

    // OP HEADER → Neon
    enqueueOp({
      deviceId: DEVICE_ID,
      opType: 'sale.created',
      entityType: 'vente',
      entityId: String(venteId),
      payload: {
        venteId,
        total,
        adherentId,           // Local ID (pour debug)
        modePaiementId,       // Local ID (pour debug)
        adherentUuid,         // 🔥 UUID pour Postgres
        modePaiementUuid,     // 🔥 UUID pour Postgres
        saleType,
        clientEmail,
        fraisPaiement,
        cotisation,
        acompte,
      },
    });

    // LIGNES
    for (const l of lignes) {
      const produitId = Number(l.produit_id);
      const qte       = Number(l.quantite);
      const prixTotal = Number(l.prix);           // TOTAL de ligne
      const pu        = Number(l.prix_unitaire);  // PU appliqué
      const remise    = Number(l.remise_percent || 0);

      if (!Number.isFinite(produitId) || !Number.isFinite(qte) || qte <= 0) {
        throw new Error('ligne de vente invalide');
      }

      // 🔍 Vérifier si le produit existe
      const produitExists = db.prepare(`SELECT id FROM produits WHERE id = ?`).get(produitId);
      if (!produitExists) {
        throw new Error(`Produit ID ${produitId} n'existe pas en local - synchronisation requise`);
      }

      insertLigne.run(venteId, produitId, qte, prixTotal, pu, remise);

      // Décrément stock via mouvement (si gestion stock active)
      // ⚠️ NE PAS créer de mouvement local - il sera créé par le serveur et importé via pull
      // Cela évite les doublons (mouvement local + mouvement serveur)
      // if (stocksOn) {
      //   try {
      //     createStockMovement(produitId, -qte, 'vente', venteId, {
      //       prix_unitaire: pu,
      //       remise_percent: remise
      //     });
      //   } catch (err) {
      //     console.error('[vente] Erreur mouvement stock:', err);
      //   }
      // }

      // 🔥 Récupérer le produitUuid (déjà sync'd normalement)
      const produitRow = db.prepare(`SELECT remote_uuid FROM produits WHERE id = ?`).get(produitId);
      const produitUuid = produitRow?.remote_uuid || null;

      // ⚠️ venteUuid sera résolu côté serveur via le mapping créé par sale.created (même batch)
      // OP LIGNE → Neon
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'sale.line_added',
        entityType: 'ligne_vente',
        entityId: String(`${venteId}:${produitId}`),
        payload: {
          ligneId: null,
          venteId,              // 🔥 Local ID → serveur résoudra via venteMappings
          produitId,            // Local ID (debug)
          produitUuid,          // 🔥 UUID pour Postgres
          quantite: qte,
          prix: prixTotal,      // total de la ligne
          prixUnitaire: pu,     // PU appliqué
          remisePercent: remise,
        },
      });
    }

    // push/pull best-effort
    try {
      const sync = require('../sync');
      if (typeof sync.pushOpsNow === 'function') {
        sync.pushOpsNow(DEVICE_ID).catch(() => {});
      }
      if (typeof sync.triggerBackgroundSync === 'function') {
        setTimeout(() => sync.triggerBackgroundSync(), 150);
      }
    } catch {}
    return venteId;
  });

  return tx();
}

/* ------------------------------------------------------------------ */
/*  Lectures                                                           */
/* ------------------------------------------------------------------ */
function getHistoriqueVentes(opts = {}) {
  const {
    limit = 50,
    offset = 0,
    search = '',
  //  dateFrom / dateTo peuvent être ISO 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS'
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
    v.id,
    v.date_vente,
    -- total recomputé de façon robuste (compat ancien/nouveau schéma de lignes)
    COALESCE(SUM(
      CASE
        -- Anciennes lignes (on stockait 'prix' comme PU) → total = prix * quantite
        WHEN (lv.prix_unitaire IS NULL OR lv.prix_unitaire = 0) THEN (lv.prix * lv.quantite)
        -- Nouvelles lignes (prix = total, prix_unitaire = PU appliqué)
        ELSE lv.prix
      END
    ), 0) AS total_produits,
    v.adherent_id,
    v.mode_paiement_id,
    v.sale_type,
    v.client_email,
    v.frais_paiement,
    v.cotisation,
    COALESCE(v.acompte, 0) AS acompte,
    -- Total final = produits + frais + cotisation - acompte
    (COALESCE(SUM(
      CASE
        WHEN (lv.prix_unitaire IS NULL OR lv.prix_unitaire = 0) THEN (lv.prix * lv.quantite)
        ELSE lv.prix
      END
    ), 0) + COALESCE(v.frais_paiement, 0) + COALESCE(v.cotisation, 0) - COALESCE(v.acompte, 0)) AS total,
    a.nom AS adherent_nom, a.prenom AS adherent_prenom,
    mp.nom AS mode_paiement_nom
  FROM ventes v
  LEFT JOIN lignes_vente lv ON lv.vente_id = v.id
  LEFT JOIN adherents a       ON a.id  = v.adherent_id
  LEFT JOIN modes_paiement mp ON mp.id = v.mode_paiement_id
  WHERE ${where}
  GROUP BY v.id
  ORDER BY v.date_vente DESC, v.id DESC
  LIMIT ? OFFSET ?
`).all(...params, Number(limit), Number(offset));
}

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
    SELECT
      lv.*,
      p.nom AS produit_nom,
      p.reference AS produit_reference,
      p.code_barre AS produit_code_barre,
      p.prix AS produit_prix,
      p.unite_id, p.fournisseur_id, p.categorie_id,
      -- total de ligne robuste (compat ancien/nouveau)
      CASE
        WHEN (lv.prix_unitaire IS NULL OR lv.prix_unitaire = 0) THEN (lv.prix * lv.quantite)
        ELSE lv.prix
      END AS total_ligne
    FROM lignes_vente lv
    LEFT JOIN produits p ON p.id = lv.produit_id
    WHERE lv.vente_id = ?
    ORDER BY lv.id
  `).all(Number(venteId));

  return { header, lignes };
}

module.exports = { enregistrerVente, getHistoriqueVentes, getDetailsVente };
