// src/main/handlers/cotisations.js
function registerCotisationHandlers(ipcMain) {
  console.log('[handlers/cotisations] registering IPC handlers');
  const cotisationsDb = require('../db/cotisations');

  ipcMain.handle('get-cotisations', () => cotisationsDb.getCotisations());
  ipcMain.handle('get-cotisations-par-adherent', (_e, adherentId) =>
    cotisationsDb.getCotisationsParAdherent(adherentId)
  );
  ipcMain.handle('ajouter-cotisation', (_e, adherentId, montant, date_paiement = null) =>
    cotisationsDb.ajouterCotisation(adherentId, montant, date_paiement)
  );
  ipcMain.handle('modifier-cotisation', (_e, c) =>
    cotisationsDb.modifierCotisation(c)
  );
  ipcMain.handle('supprimer-cotisation', (_e, id) =>
    cotisationsDb.supprimerCotisation(id)
  );
  ipcMain.handle('verifier-cotisation', (_e, adherentId) =>
    cotisationsDb.verifierCotisationAdherent(adherentId)
  );
}

module.exports = registerCotisationHandlers;
