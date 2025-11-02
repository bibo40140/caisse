// src/main/handlers/fournisseurs.js
const { ipcMain } = require('electron');
const {
  getFournisseurs,
  ajouterFournisseur,
  modifierFournisseur,
  supprimerFournisseur,
  rechercherFournisseurParNom,
  resoudreConflitFournisseur,
} = require('../db/fournisseurs');

function registerFournisseurHandlers() {
  // 🔁 Nettoyage (utile en dev/hot-reload)
  const channels = [
    'get-fournisseurs',
    'ajouter-fournisseur',
    'modifier-fournisseur',
    'supprimer-fournisseur',
    'rechercher-fournisseur-par-nom',
    'resoudre-conflit-fournisseur',
  ];
  channels.forEach((ch) => ipcMain.removeHandler(ch));

  // 📋 Liste
  ipcMain.handle('get-fournisseurs', async () => {
    return getFournisseurs();
  });

  // ➕ Ajouter (retourne l'objet avec id)
  ipcMain.handle('ajouter-fournisseur', async (_event, f = {}) => {
    try {
      if (!f.nom || !String(f.nom).trim()) {
        throw new Error("Champ 'nom' requis");
      }
      const created = ajouterFournisseur(f);
      return { ok: true, id: created.id, fournisseur: created };
    } catch (err) {
      console.error('[ajouter-fournisseur] error:', err);
      throw new Error(err.message || "Erreur lors de l’ajout du fournisseur");
    }
  });

  // ✏️ Modifier (retourne l'objet avec id)
  ipcMain.handle('modifier-fournisseur', async (_event, f = {}) => {
    try {
      if (!f.id) throw new Error("Champ 'id' requis");
      const updated = modifierFournisseur({ ...f, id: Number(f.id) });
      return { ok: true, id: updated.id, fournisseur: updated };
    } catch (err) {
      console.error('[modifier-fournisseur] error:', err);
      throw new Error(err.message || "Erreur lors de la modification du fournisseur");
    }
  });

  // ❌ Supprimer
  ipcMain.handle('supprimer-fournisseur', async (_event, id) => {
    try {
      if (!id) throw new Error("Champ 'id' requis");
      supprimerFournisseur(Number(id));
      return { ok: true };
    } catch (err) {
      console.error('[supprimer-fournisseur] error:', err);
      throw new Error(err.message || "Erreur lors de la suppression du fournisseur");
    }
  });

  // 🔍 Rechercher exact par nom
  ipcMain.handle('rechercher-fournisseur-par-nom', async (_event, nom) => {
    return rechercherFournisseurParNom(nom);
  });

  // 🔁 Résoudre conflit
  ipcMain.handle('resoudre-conflit-fournisseur', async (_event, action, nouveau, existantId) => {
    try {
      const result = resoudreConflitFournisseur(action, nouveau, existantId);
      return { ok: true, result };
    } catch (err) {
      console.error('[resoudre-conflit-fournisseur] error:', err);
      throw new Error(err.message || 'Erreur lors de la résolution du conflit');
    }
  });
}

module.exports = registerFournisseurHandlers;
