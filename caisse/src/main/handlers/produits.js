// src/main/handlers/produits.js
const { ipcMain } = require('electron');
const produitsDb = require('../db/produits');
const db = require('../db/db');
const { enqueueOp } = require('../db/ops');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

ipcMain.handle('get-produits', async (_evt, opts = {}) => {
  const produitsDb = require('../db/produits');
  return produitsDb.getProduits(opts); // ← important : pas de SELECT “*” maison
});

ipcMain.handle('ajouter-produit', (event, produit) => {
  produitsDb.ajouterProduit(produit);
});

ipcMain.handle('modifier-produit', (event, produit) => {
  // 1) récupérer l'ancien stock avant modif
  const id = Number(produit.id);
  let prevRow = null;
  try {
    prevRow = db.prepare('SELECT stock FROM produits WHERE id = ?').get(id);
  } catch (_) {}

  // 2) appliquer la modification
  produitsDb.modifierProduit(produit);

  // 3) si le champ stock a changé → enqueue op stock.set
  if (produit.hasOwnProperty('stock') && prevRow) {
    const newStock = Number(produit.stock);
    const prevStock = Number(prevRow.stock ?? 0);
    if (Number.isFinite(newStock) && newStock !== prevStock) {
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'stock.set',
        entityType: 'produit',
        entityId: String(id),
        payload: {
          productId: id,
          newStock,
          previousStock: prevStock,
          reason: 'manual_edit',
          userId: null,
          eventAt: new Date().toISOString()
        }
      });

      // Optionnel : déclenche un push immédiat
      try {
        const { pushOpsNow } = require('../sync');
        if (typeof pushOpsNow === 'function') {
          pushOpsNow(DEVICE_ID).catch(() => {});
        }
      } catch {}
    }
  }
});

ipcMain.handle('supprimer-produit', (event, id) => {
  return produitsDb.supprimerProduit(id);
});

ipcMain.handle('supprimer-et-remplacer-produit', (event, nouveau, idExistant) => {
  return produitsDb.supprimerEtRemplacerProduit(nouveau, idExistant);
});

ipcMain.handle('rechercher-produit-par-nom-et-fournisseur', (event, nom, fournisseurId) => {
  return produitsDb.rechercherProduitParNomEtFournisseur(nom, fournisseurId);
});

ipcMain.handle('produits:list', async () => {
  // Les méthodes exactes peuvent varier : getAll / list / findAll...
  if (typeof produitsDb.getAll === 'function')    return produitsDb.getAll();
  if (typeof produitsDb.list === 'function')      return produitsDb.list();
  if (typeof produitsDb.findAll === 'function')   return produitsDb.findAll();
  throw new Error('Aucune méthode pour lister les produits dans produitsDb.');
});
