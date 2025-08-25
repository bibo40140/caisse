// src/main/handlers/fournisseurs.js
const { ipcMain } = require('electron');
const fournisseursDb = require('../db/fournisseurs');

function registerFournisseurHandlers() {
  // Nettoie d'abord si déjà enregistrés (utile en dev/hot-reload)
  const channels = [
    'get-fournisseurs',
    'ajouter-fournisseur',
    'modifier-fournisseur',
    'supprimer-fournisseur',
    'rechercher-fournisseur-par-nom',
    'resoudre-conflit-fournisseur',
  ];
  channels.forEach((ch) => ipcMain.removeHandler(ch));

  ipcMain.handle('get-fournisseurs', async () => {
    return fournisseursDb.getFournisseurs();
  });

  ipcMain.handle('ajouter-fournisseur', async (_event, f) => {
    try {
      fournisseursDb.ajouterFournisseur(f);
      return { ok: true };
    } catch (err) {
      console.error('ajouter-fournisseur error:', err);
      throw new Error(err.message || 'Erreur lors de l’ajout du fournisseur');
    }
  });

  ipcMain.handle('modifier-fournisseur', async (_event, f) => {
    try {
      fournisseursDb.modifierFournisseur(f);
      return { ok: true };
    } catch (err) {
      console.error('modifier-fournisseur error:', err);
      throw new Error(err.message || 'Erreur lors de la modification du fournisseur');
    }
  });

  ipcMain.handle('supprimer-fournisseur', async (_event, id) => {
    try {
      fournisseursDb.supprimerFournisseur(id);
      return { ok: true };
    } catch (err) {
      console.error('supprimer-fournisseur error:', err);
      throw new Error(err.message || 'Erreur lors de la suppression du fournisseur');
    }
  });

  ipcMain.handle('rechercher-fournisseur-par-nom', async (_event, nom) => {
    return fournisseursDb.rechercherFournisseurParNom(nom);
  });

  ipcMain.handle('resoudre-conflit-fournisseur', async (_event, action, nouveau, existantId) => {
    try {
      const res = fournisseursDb.resoudreConflitFournisseur(action, nouveau, existantId);
      return { ok: true, result: res };
    } catch (err) {
      console.error('resoudre-conflit-fournisseur error:', err);
      throw new Error(err.message || 'Erreur lors de la résolution du conflit');
    }
  });
}

module.exports = registerFournisseurHandlers;
