// src/main/handlers/email.js
const { ipcMain } = require('electron');
const { envoyerFactureParEmail } = require('../db/email');

module.exports = function registerEmailHandlers() {
  ipcMain.handle('envoyer-facture-email', async (_event, facture) => {
    try {
      await envoyerFactureParEmail(facture);
      return { ok: true };
    } catch (err) {
      console.error("[email] Erreur lors de l'envoi :", err);
      return { ok: false, error: err.message };
    }
  });
};
