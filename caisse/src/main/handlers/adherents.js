// src/main/handlers/adherents.js
const { ipcMain } = require('electron');
const adherentsDb = require('../db/adherents');

function registerAdherentsHandlers() {
  ipcMain.handle('get-adherents', (event, archive = 0) => {
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
