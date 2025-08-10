// src/main/handlers/stock.js
const stockDb = require('../db/stock');

module.exports = function registerStockHandlers(ipcMain) {
  ipcMain.handle('decrementer-stock', (event, produitId, quantite) => {
    return stockDb.decrementerStock(produitId, quantite);
  });

  ipcMain.handle('incrementer-stock', (event, produitId, quantite) => {
    return stockDb.incrementerStock(produitId, quantite);
  });

  ipcMain.handle('mettre-a-jour-stock', (event, produitId, quantite) => {
    return stockDb.mettreAJourStock(produitId, quantite);
  });

  ipcMain.handle('get-stock', (event, produitId) => {
    return stockDb.getStock(produitId);
  });

  ipcMain.handle('reinitialiser-stock', () => {
    return stockDb.reinitialiserStock();
  });
};
