// src/main/handlers/receptions.js
const receptionsDb = require('../db/receptions');

function registerReceptionHandlers(ipcMain) {
  // ipcMain.handle('enregistrer-reception', (event, reception) => {
    // return receptionsDb.enregistrerReception(reception);
  // });
  
  ipcMain.handle('enregistrer-reception', (event, reception) => {
  try {
    const id = receptionsDb.enregistrerReception(reception);
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
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
