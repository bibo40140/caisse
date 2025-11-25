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
const { enqueueOp } = require('../db/ops');
const { getDeviceId } = require('../device');

let syncMod = null;
try {
  syncMod = require('../sync');
} catch {
  // pas bloquant
}

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function safeTriggerSync() {
  try {
    if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
      setImmediate(() => {
        try {
          syncMod.triggerBackgroundSync();
        } catch (e) {
          console.warn('[sync] triggerBackgroundSync error (fournisseurs):', e.message || e);
        }
      });
    }
  } catch {
    // on ne casse jamais le flux à cause de la sync
  }
}

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

      // enqueue op pour Neon
      try {
        enqueueOp({
          deviceId: DEVICE_ID,
          opType: 'fournisseur.created',
          entityType: 'fournisseur',
          entityId: String(created.id),
          payload: {
            id: created.id, // 🔥 ID local pour mapping
            nom: created.nom,
            contact: created.contact,
            email: created.email,
            telephone: created.telephone,
            adresse: created.adresse,
            code_postal: created.code_postal,
            ville: created.ville,
            label: created.label,
            // on envoie aussi les ids locaux pour préparer la suite
            categorie_id: created.categorie_id ?? null,
            referent_id: created.referent_id ?? null,
          },
        });
      } catch (e) {
        console.error('[ajouter-fournisseur] enqueueOp error:', e);
      }

      safeTriggerSync();

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

      // enqueue op de mise à jour
      try {
        enqueueOp({
          deviceId: DEVICE_ID,
          opType: 'fournisseur.updated',
          entityType: 'fournisseur',
          entityId: String(updated.id),
          payload: {
            nom: updated.nom,
            contact: updated.contact,
            email: updated.email,
            telephone: updated.telephone,
            adresse: updated.adresse,
            code_postal: updated.code_postal,
            ville: updated.ville,
            label: updated.label,
            categorie_id: updated.categorie_id ?? null,
            referent_id: updated.referent_id ?? null,
          },
        });
      } catch (e) {
        console.error('[modifier-fournisseur] enqueueOp error:', e);
      }

      safeTriggerSync();

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
      // (si un jour on veut sync la suppression, on ajoutera une op fournisseur.deleted ici)
      safeTriggerSync();
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
  ipcMain.handle(
    'resoudre-conflit-fournisseur',
    async (_event, action, nouveau, existantId) => {
      try {
        const result = resoudreConflitFournisseur(action, nouveau, existantId);
        return { ok: true, result };
      } catch (err) {
        console.error('[resoudre-conflit-fournisseur] error:', err);
        throw new Error(err.message || 'Erreur lors de la résolution du conflit');
      }
    }
  );
}

module.exports = registerFournisseurHandlers;
