// src/main/handlers/produits.js
const produitsDb = require('../db/produits');

/**
 * Enregistre les handlers IPC pour les produits.
 * À appeler depuis main.js : 
 *   const registerProduitHandlers = require('./handlers/produits');
 *   registerProduitHandlers();
 */
function registerProduitHandlers(ipcMain) {
  // Nettoyage des anciens handlers (hot-reload/dev)
  const channels = [
    'get-produits',
    'produits:list',
    'ajouter-produit',
    'modifier-produit',
    'supprimer-produit',
    'rechercher-produit-par-nom-et-fournisseur',
  ];
  channels.forEach((ch) => ipcMain.removeHandler(ch));

  // Liste / recherche
  ipcMain.handle('get-produits', async (_evt, opts = {}) => {
    // opts peut contenir { search, limit, offset }
    return produitsDb.getProduits(opts);
  });

  ipcMain.handle('produits:list', async (_evt, opts = {}) => {
    // compat : renvoie la même chose que get-produits sans filtre
    return produitsDb.getProduits(opts);
  });

  // Création
  ipcMain.handle('ajouter-produit', async (_evt, produit = {}) => {
    try {
      const id = produitsDb.ajouterProduit(produit);
      return { ok: true, id };
    } catch (err) {
      console.error('[ajouter-produit] error:', err);
      throw new Error(err?.message || 'Erreur lors de l’ajout du produit');
    }
  });

  // Modification
  ipcMain.handle('modifier-produit', async (_evt, produit = {}) => {
    try {
      const res = produitsDb.modifierProduit(produit);
      return res || { ok: true };
    } catch (err) {
      console.error('[modifier-produit] error:', err);
      throw new Error(err?.message || 'Erreur lors de la modification du produit');
    }
  });

  // Suppression
  ipcMain.handle('supprimer-produit', async (_evt, id) => {
    try {
      const res = produitsDb.supprimerProduit(id);
      return res || { ok: true };
    } catch (err) {
      console.error('[supprimer-produit] error:', err);
      throw new Error(err?.message || 'Erreur lors de la suppression du produit');
    }
  });

  // Recherche par nom + fournisseur (utilisé par la page Réceptions)
  ipcMain.handle(
    'rechercher-produit-par-nom-et-fournisseur',
    async (_evt, nom, fournisseurId) => {
      try {
        return produitsDb.rechercherProduitParNomEtFournisseur(nom, fournisseurId);
      } catch (err) {
        console.error('[rechercher-produit-par-nom-et-fournisseur] error:', err);
        throw new Error(err?.message || 'Erreur lors de la recherche du produit');
      }
    }
  );
}

module.exports = registerProduitHandlers;
