// src/main/handlers/cotisations.js
const { ipcMain } = require('electron');
const cotisationsDb = require('../db/cotisations');

function registerCotisationsHandlers() {
  // Nettoyage des canaux pour éviter le "second handler" en dev
  const channels = [
    'get-cotisations',
    'cotisations:list',
    'ajouter-cotisation',
    'cotisations:add',
    'modifier-cotisation',
    'cotisations:update',
    'supprimer-cotisation',
    'cotisations:delete',
    'verifier-cotisation',
    'cotisations:verifier',
    'cotisations:get-last',
  ];
  channels.forEach((ch) => ipcMain.removeHandler(ch));

  // Liste
  ipcMain.handle('get-cotisations', () => cotisationsDb.getCotisations());
  ipcMain.handle('cotisations:list', () => cotisationsDb.getCotisations());

  // Ajouter (on ignore date_paiement si la DB ne le supporte pas)
  // Appels possibles côté UI :
  //  - ajouter-cotisation, adherentId, montant, date_paiement?
  //  - cotisations:add, { adherent_id, montant, date_paiement? }
  ipcMain.handle('ajouter-cotisation', (_e, adherentId, montant /*, date_paiement = null */) => {
    return cotisationsDb.ajouterCotisation(adherentId, montant);
  });

  ipcMain.handle('cotisations:add', (_e, payload = {}) => {
    const adherentId = payload.adherent_id ?? payload.adherentId ?? payload.id;
    const montant = Number(payload.montant || 0);
    return cotisationsDb.ajouterCotisation(adherentId, montant);
  });

  // Modifier / Supprimer
  ipcMain.handle('modifier-cotisation', (_e, c) => cotisationsDb.modifierCotisation(c));
  ipcMain.handle('cotisations:update', (_e, c) => cotisationsDb.modifierCotisation(c));

  ipcMain.handle('supprimer-cotisation', (_e, id) => cotisationsDb.supprimerCotisation(id));
  ipcMain.handle('cotisations:delete', (_e, id) => cotisationsDb.supprimerCotisation(id));

  // Vérifier — on renvoie un objet riche depuis DB.verifierCotisation,
  // et on garde la compat booléenne si l’UI ancienne attend juste un bool.
  ipcMain.handle('verifier-cotisation', (_e, adherentId, opts = {}) => {
    // Essaie la version "riche"
    if (typeof cotisationsDb.verifierCotisation === 'function') {
      const out = cotisationsDb.verifierCotisation(adherentId, opts);
      // Pour compat : si on nous a explicitement demandé "boolOnly"
      if (opts && opts.boolOnly) return !!out?.actif;
      return out; // { actif, status, expire_le, derniere_cotisation }
    }
    // Fallback: ancien booléen
    return cotisationsDb.verifierCotisationAdherent(adherentId);
  });

  ipcMain.handle('cotisations:verifier', (_e, payload = {}) => {
    const adherentId = payload.adherent_id ?? payload.adherentId ?? payload.id;
    const opts = { graceDays: Number(payload.graceDays || 0) };
    if (typeof cotisationsDb.verifierCotisation === 'function') {
      return cotisationsDb.verifierCotisation(adherentId, opts);
    }
    return { actif: !!cotisationsDb.verifierCotisationAdherent(adherentId) };
  });

  // Dernière cotisation (utile à l’UI pour afficher l’info)
  ipcMain.handle('cotisations:get-last', (_e, adherentId) => {
    if (typeof cotisationsDb.getDerniereCotisation === 'function') {
      return cotisationsDb.getDerniereCotisation(adherentId);
    }
    // Compat: on renvoie null si non dispo
    return null;
  });
}

module.exports = registerCotisationsHandlers;
