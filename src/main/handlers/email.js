const { envoyerFactureParEmail } = require('../db/email');

module.exports = (ipcMain) => {
  ipcMain.handle('envoyer-facture-email', async (event, data) => {
    try {
      if (!data.email) {
        throw new Error("Aucune adresse email fournie.");
      }

      await envoyerFactureParEmail(data);
    } catch (err) {
      console.error("Erreur envoi email :", err);
      throw err;
    }
  });
};
