// src/main/handlers/produits.js
const db = require('../db/db');
const produitsDb = require('../db/produits');
const { enqueueOp } = require('../db/ops');
const { getDeviceId } = require('../device');

let syncMod = null;
try {
  syncMod = require('../sync');
} catch {
  // pas bloquant
}

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

/** Déclenche une synchro en arrière-plan (best-effort) */
function safeTriggerSync() {
  try {
    if (syncMod && typeof syncMod.triggerBackgroundSync === 'function') {
      setImmediate(() => {
        try {
          syncMod.triggerBackgroundSync(); // pas de .catch ici
        } catch (e) {
          console.warn(
            '[sync] triggerBackgroundSync error (produits):',
            e.message || e
          );
        }
      });
    }
  } catch {
    // on ne casse jamais le flux à cause de la sync
  }
}

/** Recharge un produit complet depuis SQLite */
function loadProduitById(id) {
  try {
    const row = db
      .prepare(
        `SELECT id, nom, reference, prix, stock, code_barre,
                unite_id, fournisseur_id, categorie_id, updated_at
         FROM produits
         WHERE id = ?`
      )
      .get(Number(id));
    return row || null;
  } catch (e) {
    console.error('[handlers/produits] loadProduitById error:', e);
    return null;
  }
}

/**
 * Enregistre les handlers IPC pour les produits.
 * À appeler depuis main.js :
 *   const registerProduitHandlers = require('./handlers/produits');
 *   registerProduitHandlers(ipcMain);
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
    'produit:has-remote-uuid',
  ];
  channels.forEach((ch) => {
    try {
      ipcMain.removeHandler(ch);
    } catch {}
  });

  // Liste / recherche
  ipcMain.handle('get-produits', async (_evt, opts = {}) => {
    return produitsDb.getProduits(opts);
  });

  ipcMain.handle('produits:list', async (_evt, opts = {}) => {
    return produitsDb.getProduits(opts);
  });

  // ➕ Création produit (local + op + sync)
  ipcMain.handle('ajouter-produit', async (_evt, produit = {}) => {
    try {
      // 1) insertion locale → retourne l'id
      const id = produitsDb.ajouterProduit(produit);

      // 2) on recharge le produit complet pour le payload & le retour
      const created = loadProduitById(id) || { id, ...produit };

      // 3) enqueue op vers Neon
      try {
        // Convertir les IDs locaux en UUID pour le serveur
        let uniteUuid = null;
        let categorieUuid = null;
        let fournisseurUuid = null;
        
        if (created.unite_id) {
          const unite = db.prepare('SELECT remote_uuid FROM unites WHERE id = ?').get(created.unite_id);
          uniteUuid = unite?.remote_uuid || null;
        }
        
        if (created.categorie_id) {
          const categorie = db.prepare('SELECT remote_uuid FROM categories WHERE id = ?').get(created.categorie_id);
          categorieUuid = categorie?.remote_uuid || null;
        }
        
        if (created.fournisseur_id) {
          const fournisseur = db.prepare('SELECT remote_uuid FROM fournisseurs WHERE id = ?').get(created.fournisseur_id);
          fournisseurUuid = fournisseur?.remote_uuid || null;
        }
        
        enqueueOp({
          deviceId: DEVICE_ID,
          opType: 'product.created',
          entityType: 'produit',
          entityId: String(id),
          payload: {
            local_id: created.id,
            nom: created.nom,
            reference: created.reference,
            prix: created.prix,
            stock: created.stock,
            code_barre: created.code_barre,
            unite_id: uniteUuid,
            fournisseur_id: fournisseurUuid,
            categorie_id: categorieUuid,
          },
        });
      } catch (e) {
        console.error('[ajouter-produit] enqueueOp error:', e);
      }

      // 4) synchro en arrière-plan
      safeTriggerSync();

      return { ok: true, id, produit: created };
    } catch (err) {
      console.error('[ajouter-produit] error:', err);
      throw new Error(err?.message || "Erreur lors de l’ajout du produit");
    }
  });

  // ✏️ Modification produit (local + op + sync)
  ipcMain.handle('modifier-produit', async (_evt, produit = {}) => {
    try {
      // 1) update local
      const res = produitsDb.modifierProduit(produit);

      const id = Number(produit.id);
      const updated = Number.isFinite(id) ? loadProduitById(id) : null;

      // 2) enqueue op product.updated (payload = état complet)
      if (updated) {
        try {
          // Convertir les IDs locaux en UUID pour le serveur
          let uniteUuid = null;
          let categorieUuid = null;
          let fournisseurUuid = null;
          
          if (updated.unite_id) {
            const unite = db.prepare('SELECT remote_uuid FROM unites WHERE id = ?').get(updated.unite_id);
            uniteUuid = unite?.remote_uuid || null;
          }
          
          if (updated.categorie_id) {
            const categorie = db.prepare('SELECT remote_uuid FROM categories WHERE id = ?').get(updated.categorie_id);
            categorieUuid = categorie?.remote_uuid || null;
          }
          
          if (updated.fournisseur_id) {
            const fournisseur = db.prepare('SELECT remote_uuid FROM fournisseurs WHERE id = ?').get(updated.fournisseur_id);
            fournisseurUuid = fournisseur?.remote_uuid || null;
          }
          
          enqueueOp({
            deviceId: DEVICE_ID,
            opType: 'product.updated',
            entityType: 'produit',
            entityId: String(updated.id),
            payload: {
              id: updated.id,
              nom: updated.nom,
              reference: updated.reference,
              prix: updated.prix,
              stock: updated.stock,
              code_barre: updated.code_barre,
              unite_id: uniteUuid,
              fournisseur_id: fournisseurUuid,
              categorie_id: categorieUuid,
            },
          });
        } catch (e) {
          console.error('[modifier-produit] enqueueOp error:', e);
        }
      }

      // 3) synchro en arrière-plan
      safeTriggerSync();

      return res || { ok: true, produit: updated };
    } catch (err) {
      console.error('[modifier-produit] error:', err);
      throw new Error(
        err?.message || 'Erreur lors de la modification du produit'
      );
    }
  });

  // ❌ Suppression (pour l’instant : uniquement local, pas d’op distante)
  ipcMain.handle('supprimer-produit', async (_evt, id) => {
    try {
      // Récupérer les infos du produit avant suppression
      const produit = produitsDb.getProduit(id);
      
      // Soft delete
      const res = produitsDb.supprimerProduit(id);
      
      // Créer une opération product.deleted pour la sync
      if (produit) {
        const { enqueueOp } = require('../db/ops');
        const DEVICE_ID = process.env.DEVICE_ID || 'caisse-default';
        
        enqueueOp({
          deviceId: DEVICE_ID,
          opType: 'product.deleted',
          entityType: 'produit',
          entityId: String(id),
          payload: {
            id: id,
            reference: produit.reference,
            remote_uuid: produit.remote_uuid
          }
        });
      }
      
      safeTriggerSync();
      return res || { ok: true };
    } catch (err) {
      console.error('[supprimer-produit] error:', err);
      throw new Error(
        err?.message || 'Erreur lors de la suppression du produit'
      );
    }
  });

  // Recherche par nom + fournisseur (utilisé par la page Réceptions)
  ipcMain.handle(
    'rechercher-produit-par-nom-et-fournisseur',
    async (_evt, nom, fournisseurId) => {
      try {
        return produitsDb.rechercherProduitParNomEtFournisseur(
          nom,
          fournisseurId
        );
      } catch (err) {
        console.error(
          '[rechercher-produit-par-nom-et-fournisseur] error:',
          err
        );
        throw new Error(
          err?.message || 'Erreur lors de la recherche du produit'
        );
      }
    }
  );

  // 🔍 Vérifier si un produit a un remote_uuid (pour attendre la sync)
  ipcMain.handle('produit:has-remote-uuid', async (_evt, produitId) => {
    try {
      const db = require('../db/db');
      const row = db.prepare('SELECT remote_uuid FROM produits WHERE id = ?').get(Number(produitId));
      const hasUuid = !!(row && row.remote_uuid);
      console.log(`[produit:has-remote-uuid] produit ${produitId} → remote_uuid: ${row?.remote_uuid || 'NULL'} (has: ${hasUuid})`);
      return hasUuid;
    } catch (err) {
      console.error('[produit:has-remote-uuid] error:', err);
      return false;
    }
  });
}

module.exports = registerProduitHandlers;
