// src/main/handlers/receptions.js
// Réceptions robustes (contrat: retourne un NOMBRE = id)
// - Écrit la réception + lignes (bloquant).
// - Met à jour le stock local (champ produits.stock) en respectant "corriger le stock".
// - Enfile des ops reception.line_added pour le serveur.
// - N’expose qu’UN canal IPC: 'receptions:create' (évite les doubles appels).

const db = require('../db/db');
const receptionsDb = require('../db/receptions');
const crypto = require('crypto');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// ----------------------------------------------------
// Utils
// ----------------------------------------------------
function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
      );
}

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

function getCurrentLocalStock(prodId) {
  const r = db.prepare(`SELECT stock FROM produits WHERE id = ?`).get(Number(prodId));
  return Number(r?.stock ?? 0);
}

function setLocalProductStock(prodId, newStock) {
  db.prepare(`
    UPDATE produits
       SET stock = ?, updated_at = datetime('now','localtime')
     WHERE id = ?
  `).run(Number(newStock), Number(prodId));
}

function normalizeLignes(input) {
  if (!Array.isArray(input)) return [];
  return input.map(l => {
    const produitId    = Number(l.produit_id ?? l.produitId ?? l.product_id ?? l.id);
    const quantite     = Number(l.quantite ?? l.qty ?? l.qte ?? l['quantité'] ?? 0);
    const puRaw        = (l.prix_unitaire ?? l.pu ?? l.price);
    const prixUnitaire = (puRaw === '' || puRaw == null) ? null : Number(puRaw);
    const corrRaw      = (l.stock_corrige ?? l.stockCorrige);
    const stockCorrige = (corrRaw === '' || corrRaw == null) ? null : Number(corrRaw);

    return { produit_id: produitId, quantite, prix_unitaire: prixUnitaire, stock_corrige: stockCorrige };
  }).filter(l =>
    Number.isFinite(l.produit_id) && l.produit_id > 0 &&
    Number.isFinite(l.quantite)   && l.quantite   > 0
  );
}

function normalizeReceptionHeader(raw = {}) {
  const fournisseur_id =
    raw.fournisseur_id ?? raw.fournisseurId ?? raw.supplier_id ?? raw.supplierId;
  return {
    fournisseur_id: Number(fournisseur_id),
    reference: raw.reference ?? raw.ref ?? null,
  };
}

// ----------------------------------------------------
// Cœur : crée la réception, met à jour le stock local, enfile les ops
// ----------------------------------------------------
function coreCreate(payload = {}) {
  // 1) normalisation
  const reception = normalizeReceptionHeader(payload.reception ? payload.reception : payload);
  const lignesRaw = payload.lignes ?? payload.items ?? payload.produits ?? payload.lines ?? [];
  const lignes    = normalizeLignes(lignesRaw);

  if (!Number.isFinite(reception.fournisseur_id) || reception.fournisseur_id <= 0) {
    throw new Error('fournisseur_id manquant ou invalide');
  }
  if (lignes.length === 0) {
    throw new Error('aucune ligne de réception');
  }

  // 2) enregistrement réception + lignes (bloquant)
  const id = receptionsDb.enregistrerReception(reception, lignes);

  // 3) mise à jour du stock local + ops (best-effort : on loggue mais on ne bloque pas)
  try {
    const tx = db.transaction(() => {
      for (const l of lignes) {
        const current = getCurrentLocalStock(l.produit_id);
        const qte     = Number(l.quantite || 0);
        const hasCorr = (l.stock_corrige !== null) && Number.isFinite(Number(l.stock_corrige));
        const base    = hasCorr ? Number(l.stock_corrige) : current;
        const target  = base + qte;
        const delta   = target - current;

        // a) MAJ champ local produits.stock pour que l'UI voie la bonne valeur
        setLocalProductStock(l.produit_id, target);

        // b) enfile op reception.line_added (serveur calculera son mouvement à partir de ça)
        enqueueOp({
          op_type: 'reception.line_added',
          entity_type: 'ligne_reception',
          entity_id: `${id}:${l.produit_id}`,
          payload: {
            receptionId: id,
            fournisseurId: reception.fournisseur_id,
            reference: reception.reference ?? null,
            produitId: l.produit_id,
            quantite: qte,
            prixUnitaire: (l.prix_unitaire != null ? Number(l.prix_unitaire) : null),
            stockCorrige: hasCorr ? Number(l.stock_corrige) : null
          }
        });

        // NOTE : on NE ré-enfile PAS de 'stock_movement.add' ici pour éviter un double comptage côté serveur.
        // Le serveur gère le mouvement via 'reception.line_added'.
      }
    });
    tx();
  } catch (e) {
    console.warn('[receptions] WARN (best-effort) MAJ stock/ops:', e?.message || e);
  }

  return { id };
}

// ----------------------------------------------------
// IPC
// ----------------------------------------------------
function registerReceptionHandlers(ipcMain) {
  console.log('[handlers/receptions] registering IPC handlers');

  // Unique canal moderne — retourne UN NOMBRE (id)
  ipcMain.handle('receptions:create', (_e, payload = {}) => {
    try {
      const { id } = coreCreate(payload);
      console.log('[receptions] created (modern) -> id', id);
      return id; // <= important: un nombre attendu par l’UI → pas de popup
    } catch (e) {
      const msg = e?.message || 'inconnue';
      console.error('[receptions] ERROR (modern):', msg);
      throw new Error(msg);
    }
  });

  // ⚠️ Ne PAS enregistrer l'ancien alias pour éviter les doubles appels
  // Si tu DOIS garder la compat, fais-le pointer aussi sur coreCreate et retourne un NOMBRE.
  // ipcMain.handle('enregistrer-reception', (_e, payload = {}) => {
  //   try { const { id } = coreCreate(payload); return id; }
  //   catch (e) { throw new Error(e?.message || 'inconnue'); }
  // });

  // Liste / Détails (inchangés)
  ipcMain.handle('receptions:list', (_e, opts) => {
    try { return receptionsDb.getReceptions(opts || {}); }
    catch (e) { console.error('[ipc] receptions:list ERROR:', e?.message || e); return []; }
  });

  ipcMain.handle('receptions:get', (_e, receptionId) => {
    try { return receptionsDb.getDetailsReception(receptionId); }
    catch (e) { console.error('[ipc] receptions:get ERROR:', e?.message || e); return { header: null, lignes: [] }; }
  });
}

module.exports = { registerReceptionHandlers };
