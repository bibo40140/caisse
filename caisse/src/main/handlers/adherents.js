// src/main/handlers/adherents.js
const { ipcMain } = require('electron');
const adherentsDb = require('../db/adherents');

function registerAdherentsHandlers() {
   try { ipcMain.removeHandler('get-adherents'); } catch {}

  ipcMain.handle('get-adherents', (_e, arg) => {
    let archive = 0;
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      archive = Number(arg);
    } else if (arg && typeof arg === 'object' && arg.archive != null) {
      archive = Number(arg.archive);
    }
    return adherentsDb.getAdherents(archive);
  });


  ipcMain.handle('ajouter-adherent', (event, data) => {
    return adherentsDb.ajouterAdherent(data);
  });

  ipcMain.handle('modifier-adherent', (event, data) => {
    return adherentsDb.modifierAdherent(data);
  });

  ipcMain.handle('archiver-adherent', (event, id) => {
    return adherentsDb.archiverAdherent(id);
  });

  ipcMain.handle('reactiver-adherent', (event, id) => {
    return adherentsDb.reactiverAdherent(id);
  });
}

module.exports = registerAdherentsHandlers;
