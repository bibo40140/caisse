// src/main/handlers/ventes.js
const ventesDb = require('../db/ventes');

module.exports = function registerVentesHandlers(ipcMain) {
  ipcMain.handle('enregistrer-vente', (event, vente) => {
    return ventesDb.enregistrerVente(vente);
  });

  ipcMain.handle('get-ventes', () => {
    return ventesDb.getVentes();
  });

  ipcMain.handle('get-details-vente', (event, venteId) => {
    return ventesDb.getDetailsVente(venteId);
  });
  
};
