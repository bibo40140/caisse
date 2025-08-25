// src/main/handlers/cotisations.js
const { ipcMain } = require('electron');
const cotisationsDb = require('../db/cotisations');

ipcMain.handle('get-cotisations', () => {
  return cotisationsDb.getCotisations();
});

// ✅ on remplace `date` par `date_paiement` dans les paramètres
ipcMain.handle('ajouter-cotisation', (event, adherentId, montant, date_paiement = null) => {
  return cotisationsDb.ajouterCotisation(adherentId, montant, date_paiement);
});

ipcMain.handle('modifier-cotisation', (event, cotisation) => {
  return cotisationsDb.modifierCotisation(cotisation);
});

ipcMain.handle('supprimer-cotisation', (event, id) => {
  return cotisationsDb.supprimerCotisation(id);
});

ipcMain.handle('verifier-cotisation', (event, adherentId) => {
  return cotisationsDb.verifierCotisationAdherent(adherentId);
});

