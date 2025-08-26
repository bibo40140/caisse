// src/main/handlers/produits.js
const { ipcMain } = require('electron');
const produitsDb = require('../db/produits');

ipcMain.handle('get-produits', async (_evt, opts = {}) => {
  const produitsDb = require('../db/produits');
  return produitsDb.getProduits(opts); // ← important : pas de SELECT “*” maison
});


ipcMain.handle('ajouter-produit', (event, produit) => {
  produitsDb.ajouterProduit(produit);
});

ipcMain.handle('modifier-produit', (event, produit) => {
  produitsDb.modifierProduit(produit);
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
  // Prends celle que TU as dans src/main/db/produits.js
  if (typeof produitsDb.getAll === 'function')    return produitsDb.getAll();
  if (typeof produitsDb.list === 'function')      return produitsDb.list();
  if (typeof produitsDb.findAll === 'function')   return produitsDb.findAll();
  // Fallback générique sur SQLite si tu exposes "db" direct :
  // const db = require('../db/db'); return db.prepare('SELECT * FROM produits').all();
  throw new Error('Aucune méthode pour lister les produits dans produitsDb.');
});
