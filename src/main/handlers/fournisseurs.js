// src/main/handlers/fournisseurs.js
const { ipcMain } = require('electron');
const fournisseursDb = require('../db/fournisseurs');

function registerFournisseurHandlers() {
  ipcMain.handle('get-fournisseurs', () => {
    return fournisseursDb.getFournisseurs();
  });

  ipcMain.handle('ajouter-fournisseur', (event, f) => {
    return fournisseursDb.ajouterFournisseur(f);
  });

  ipcMain.handle('modifier-fournisseur', (event, f) => {
    return fournisseursDb.modifierFournisseur(f);
  });

  ipcMain.handle('supprimer-fournisseur', (event, id) => {
    return fournisseursDb.supprimerFournisseur(id);
  });

  ipcMain.handle('rechercher-fournisseur-par-nom', (event, nom) => {
    return fournisseursDb.rechercherFournisseurParNom(nom);
  });

 
}

module.exports = registerFournisseurHandlers;
