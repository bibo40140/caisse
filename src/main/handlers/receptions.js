// src/main/handlers/receptions.js
const receptionsDb = require('../db/receptions');

function registerReceptionHandlers(ipcMain) {
  ipcMain.handle('enregistrer-reception', (event, reception) => {
    return receptionsDb.enregistrerReception(reception);
  });

  ipcMain.handle('get-receptions', () => {
    return receptionsDb.getReceptions();
  });

  ipcMain.handle('get-details-reception', (event, receptionId) => {
    return receptionsDb.getDetailsReception(receptionId);
  });
}

module.exports = {
  registerReceptionHandlers
};
