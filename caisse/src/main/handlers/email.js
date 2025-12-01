// src/main/handlers/email.js
const { ipcMain } = require('electron');
const {
  envoyerFactureParEmail,
  envoyerEmailGenerique,
} = require('../db/email');

module.exports = function registerEmailHandlers() {
  console.log('[email] registering IPC handlers');

  // === Envoi facture ===
  ipcMain.handle('envoyer-facture-email', async (_e, facture) => {
    try {
      await envoyerFactureParEmail(facture);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // === Envoi générique (inventaire, etc.) ===
  ipcMain.handle('send-inventory-recap-email', async (_e, payload) => {
    try {
      await envoyerEmailGenerique(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
};
