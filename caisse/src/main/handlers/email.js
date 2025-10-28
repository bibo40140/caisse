const { ipcMain } = require('electron');
const { envoyerFactureParEmail, envoyerEmailGenerique } = require('../db/email');

module.exports = function registerEmailHandlers() {
  ipcMain.handle('envoyer-facture-email', async (_e, facture) => {
    try { await envoyerFactureParEmail(facture); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('send-inventory-recap-email', async (_e, payload) => {
    try { await envoyerEmailGenerique(payload); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
};
