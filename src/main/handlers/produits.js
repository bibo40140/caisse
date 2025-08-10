// src/main/handlers/produits.js
const { ipcMain } = require('electron');
const produitsDb = require('../db/produits');

ipcMain.handle('get-produits', () => {
  return produitsDb.getProduits();
});

ipcMain.handle('ajouter-produit', (event, produit) => {
  produitsDb.ajouterProduit(produit);
});

ipcMain.handle('modifier-produit', (event, produit) => {
  produitsDb.modifierProduit(produit);
});

ipcMain.handle('supprimer-produit', (event, id) => {
  produitsDb.supprimerProduit(id);
});

ipcMain.handle('supprimer-et-remplacer-produit', (event, nouveau, idExistant) => {
  return produitsDb.supprimerEtRemplacerProduit(nouveau, idExistant);
});

ipcMain.handle('rechercher-produit-par-nom-et-fournisseur', (event, nom, fournisseurId) => {
  return produitsDb.rechercherProduitParNomEtFournisseur(nom, fournisseurId);
});
