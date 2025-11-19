// src/main/handlers/adherents.js
const { ipcMain } = require('electron');
const adherentsDb = require('../db/adherents');
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
      syncMod.triggerBackgroundSync();   // pas de .catch ici
    } catch (e) {
      // on ignore les erreurs de sync pour ne pas casser l’UI
      console.warn('[sync] triggerBackgroundSync error (background):', e.message || e);
    }
  });
}

  } catch {
    // on ne casse jamais le flux à cause de la sync
  }
}

function registerAdherentsHandlers() {
  try {
    ipcMain.removeHandler('get-adherents');
    ipcMain.removeHandler('ajouter-adherent');
    ipcMain.removeHandler('modifier-adherent');
    ipcMain.removeHandler('archiver-adherent');
    ipcMain.removeHandler('reactiver-adherent');
  } catch {}

  ipcMain.handle('get-adherents', (_e, arg) => {
    let archive = 0;
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      archive = Number(arg);
    } else if (arg && typeof arg === 'object' && arg.archive != null) {
      archive = Number(arg.archive);
    }
    return adherentsDb.getAdherents(archive);
  });

  // ➕ Ajouter adhérent (local + enqueue op + sync)
  ipcMain.handle('ajouter-adherent', async (_event, data) => {
    // 1) insertion locale
    const created = adherentsDb.ajouterAdherent(data || {});

    // 2) enqueue op pour Neon
    try {
      enqueueOp({
        deviceId: DEVICE_ID,
        opType: 'adherent.created',
        entityType: 'adherent',
        entityId: String(created.id),
        payload: {
          local_id: created.id,
          nom: created.nom,
          prenom: created.prenom,
          email1: created.email1,
          email2: created.email2,
          telephone1: created.telephone1,
          telephone2: created.telephone2,
          adresse: created.adresse,
          code_postal: created.code_postal,
          ville: created.ville,
          nb_personnes_foyer: created.nb_personnes_foyer,
          tranche_age: created.tranche_age,
          statut: created.statut,
          archive: created.archive,
        },
      });
    } catch (e) {
      console.error('[ajouter-adherent] enqueueOp error:', e);
    }

    // 3) best-effort : push en arrière-plan
    safeTriggerSync();

    // 4) on renvoie l’objet créé au renderer
    return created;
  });

  // ✏️ Modifier adhérent (pour l’instant : uniquement local, on ajoutera un op adherent.updated plus tard si besoin)
  ipcMain.handle('modifier-adherent', async (_event, data) => {
    const res = adherentsDb.modifierAdherent(data || {});
    // TODO (plus tard) : enqueueOp('adherent.updated', ...)
    safeTriggerSync();
    return res;
  });

  ipcMain.handle('archiver-adherent', async (_event, id) => {
    adherentsDb.archiverAdherent(id);
    // TODO (plus tard) : op adherent.archived
    safeTriggerSync();
    return { ok: true };
  });

  ipcMain.handle('reactiver-adherent', async (_event, id) => {
    adherentsDb.reactiverAdherent(id);
    // TODO (plus tard) : op adherent.reactivated
    safeTriggerSync();
    return { ok: true };
  });
}

module.exports = registerAdherentsHandlers;
