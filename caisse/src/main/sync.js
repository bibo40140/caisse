// src/main/sync.js
'use strict';

const { BrowserWindow } = require('electron');
const db = require('./db/db');
const { apiFetch } = require('./apiClient');
const { getDeviceId } = require('./device');
const logger = require('./logger');
const cache = require('./cache'); // 📦 Système de cache

// ID du device (stable pour ce poste)
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

// Configuration retry
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

/**
 * Détecte le type d'erreur réseau pour un traitement approprié
 */
function classifyNetworkError(error) {
  const errStr = String(error?.message || error).toLowerCase();
  
  if (errStr.includes('fetch failed') || errStr.includes('econnrefused') || errStr.includes('enotfound')) {
    return { type: 'offline', retryable: true, message: 'Serveur inaccessible' };
  }
  if (errStr.includes('timeout') || errStr.includes('etimedout')) {
    return { type: 'timeout', retryable: true, message: 'Délai d\'attente dépassé' };
  }
  if (errStr.includes('unauthorized') || errStr.includes('401')) {
    return { type: 'auth', retryable: false, message: 'Authentification requise' };
  }
  if (errStr.includes('forbidden') || errStr.includes('403')) {
    return { type: 'forbidden', retryable: false, message: 'Accès refusé' };
  }
  if (errStr.includes('500') || errStr.includes('502') || errStr.includes('503')) {
    return { type: 'server', retryable: true, message: 'Erreur serveur' };
  }
  
  return { type: 'unknown', retryable: true, message: 'Erreur inconnue' };
}

/**
 * Exécute une fonction avec retry automatique et backoff exponentiel
 */
async function withRetry(fn, context = 'operation') {
  let lastError = null;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorInfo = classifyNetworkError(error);
      
      // Ne pas retry si l'erreur n'est pas retryable (ex: 401, 403)
      if (!errorInfo.retryable) {
        logger.error('sync', `${context}: erreur non-retryable`, {
          type: errorInfo.type,
          message: errorInfo.message,
          error: String(error)
        });
        throw error;
      }
      
      // Si c'est le dernier essai, abandonner
      if (attempt === RETRY_CONFIG.maxRetries) {
        logger.error('sync', `${context}: échec après ${RETRY_CONFIG.maxRetries} tentatives`, {
          type: errorInfo.type,
          message: errorInfo.message,
          error: String(error)
        });
        throw error;
      }
      
      // Calculer le délai avec backoff exponentiel
      const delay = Math.min(
        RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );
      
      logger.warn('sync', `${context}: tentative ${attempt + 1}/${RETRY_CONFIG.maxRetries} échouée, retry dans ${delay}ms`, {
        type: errorInfo.type,
        message: errorInfo.message
      });
      
      // Attendre avant de réessayer
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// helpers simples
const b2i = (v) => (v ? 1 : 0);

function notifyRenderer(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      w.webContents.send(channel, payload);
    } catch (_) {}
  });
}

/* petites aides pour le chip (badge sync dans l'UI) */
function setState(status, info = {}) {
  // status: 'online' | 'offline' | 'pushing' | 'pulling' | 'idle'
  notifyRenderer('sync:state', { status, ...info, ts: Date.now() });
}

/* ========== Utils schéma local ========== */
function tableCols(table) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    const set = new Set(rows.map((r) => r.name));
    return { set, rows };
  } catch {
    return { set: new Set(), rows: [] };
  }
}

function hasCol(table, col) {
  return tableCols(table).set.has(col);
}

function asIntOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

/* -------------------------------------------------
   PULL refs depuis Neon -> (pour l’instant) lecture seule

   ⚠️ Version "safe" : on ne MODIFIE PAS la base locale.
   - On interroge Neon
   - On met à jour l’état de sync + on renvoie juste les counts
   - AUCUN DELETE / INSERT / UPDATE dans SQLite ici.

   ➜ La vérité reste 100% locale pour :
     - unites / familles / categories
     - adherents
     - fournisseurs / produits
     - modes_paiement

   ➜ Neon reçoit les données via push_ops (création d’adhérents,
     fournisseurs, produits, ventes, réceptions...). On ajoutera
     plus tard un vrai pull "fine-grain" quand tout sera figé.
--------------------------------------------------*/
async function pullRefs({ since = null } = {}) {
  // Si 'since' non fourni, récupérer le dernier timestamp de sync réussie
  if (!since) {
    try {
      const row = db.prepare('SELECT last_sync_at FROM sync_state WHERE entity_type = ?').get('pull_refs');
      since = row?.last_sync_at || null;
      if (since) {
        console.log('[sync] Pull incrémental depuis:', since);
      } else {
        console.log('[sync] Pull complet (premier sync ou pas de lastSync)');
      }
    } catch (e) {
      console.warn('[sync] Erreur lecture sync_state pour pull_refs:', e);
      since = null;
    }
  }

  const qs = since ? `?since=${encodeURIComponent(since)}` : '';

  setState('pulling');
  
  return await withRetry(async () => {
    let res;
    try {
      res = await apiFetch(`/sync/pull_refs${qs}`, { method: 'GET' });
    } catch (e) {
      const errorInfo = classifyNetworkError(e);
      logger.error('sync', 'pullRefs: erreur réseau', { error: String(e), type: errorInfo.type });
      setState('offline', { error: errorInfo.message });
      throw e;
    }

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      logger.error('sync', `pullRefs: HTTP ${res.status}`, { response: t });
      setState('offline', { error: `HTTP ${res.status}` });
      throw new Error(`pull_refs ${res.status} ${t}`);
    }

    const json = await res.json();
    const d = json?.data || {};
    const {
      unites = [],
      familles = [],
      categories = [],
      adherents = [],
      fournisseurs = [],
      produits = [],
      modes_paiement = [],
      stock_movements = [],
      inventory_sessions = [],
      modules = null,
    } = d;

      // 🔄 Synchroniser les modules depuis le serveur
      if (modules && typeof modules === 'object') {
      try {
        const { readConfig, writeModules } = require('./db/config');
        const currentConfig = readConfig();
        const currentModules = currentConfig?.modules || {};
      
        // Comparer et mettre à jour seulement si différent
        const isDifferent = JSON.stringify(currentModules) !== JSON.stringify(modules);
        if (isDifferent) {
          writeModules(modules);
          console.log('[sync] Modules synchronisés depuis serveur:', modules);
        
          // Notifier le renderer pour qu'il recharge les modules
          notifyRenderer('modules:updated', { modules });
        }
      } catch (e) {
        console.error('[sync] Erreur sync modules:', e?.message || e);
      }
    }

    // 🔥 Importer les fournisseurs depuis Neon dans la base locale
    if (fournisseurs && fournisseurs.length > 0) {
      try {
        console.log(`[sync] pull: ${fournisseurs.length} fournisseurs reçus depuis Neon`);
        const checkF = db.prepare('SELECT id FROM fournisseurs WHERE remote_uuid = ?');
        const insertF = db.prepare(`
          INSERT INTO fournisseurs (remote_uuid, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
        `);
        const updateF = db.prepare(`
          UPDATE fournisseurs SET
            nom = ?, contact = ?, email = ?, telephone = ?, adresse = ?, code_postal = ?, ville = ?
          WHERE remote_uuid = ?
        `);

        const txF = db.transaction(() => {
          for (const f of fournisseurs) {
            try {
              const exists = checkF.get(f.id);
              if (exists) {
                updateF.run(
                  f.nom || '',
                  f.contact || null,
                  f.email || null,
                  f.telephone || null,
                  f.adresse || null,
                  f.code_postal || null,
                  f.ville || null,
                  f.id
                );
              } else {
                insertF.run(
                  f.id,
                  f.nom || '',
                  f.contact || null,
                  f.email || null,
                  f.telephone || null,
                  f.adresse || null,
                  f.code_postal || null,
                  f.ville || null
                );
              }
            } catch (e) {
              console.warn('[sync] erreur import fournisseur:', f?.nom, e?.message || e);
            }
          }
        });
        txF();
      } catch (e) {
        console.warn('[sync] import fournisseurs échoué:', e?.message || e);
      }
    }

    // 🔥 Importer les adhérents depuis Neon dans la base locale
    if (adherents && adherents.length > 0) {
      try {
        console.log(`[sync] pull: ${adherents.length} adhérents reçus depuis Neon`);
        // 🔥 Chercher par remote_uuid (priorité) OU par (nom + email1) pour éviter les doublons en cas de race condition
        const checkA = db.prepare(`
          SELECT id FROM adherents 
          WHERE remote_uuid = ? 
             OR (nom = ? AND email1 = ?)
          LIMIT 1
        `);
        const insertA = db.prepare(`
          INSERT INTO adherents (remote_uuid, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville, 
            nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const updateA = db.prepare(`
          UPDATE adherents SET
            nom = ?, prenom = ?, email1 = ?, email2 = ?, telephone1 = ?, telephone2 = ?, 
            adresse = ?, code_postal = ?, ville = ?, nb_personnes_foyer = ?, tranche_age = ?, 
            droit_entree = ?, date_inscription = ?, archive = ?, date_archivage = ?, date_reactivation = ?, remote_uuid = ?
          WHERE id = ?
        `);

        const txA = db.transaction(() => {
          for (const a of adherents) {
            try {
              const exists = checkA.get(a.id, a.nom || null, a.email1 || null);
              if (exists) {
                // Mets à jour ET assure que remote_uuid est bien défini (pour éviter les race conditions)
                updateA.run(
                  a.nom || null,
                  a.prenom || null,
                  a.email1 || null,
                  a.email2 || null,
                  a.telephone1 || null,
                  a.telephone2 || null,
                  a.adresse || null,
                  a.code_postal || null,
                  a.ville || null,
                  a.nb_personnes_foyer || null,
                  a.tranche_age || null,
                  a.droit_entree || null,
                  a.date_inscription || null,
                  b2i(a.archive),
                  a.date_archivage || null,
                  a.date_reactivation || null,
                  a.id,
                  exists.id
                );
              } else {
                insertA.run(
                  a.id,
                  a.nom || null,
                  a.prenom || null,
                  a.email1 || null,
                  a.email2 || null,
                  a.telephone1 || null,
                  a.telephone2 || null,
                  a.adresse || null,
                  a.code_postal || null,
                  a.ville || null,
                  a.nb_personnes_foyer || null,
                  a.tranche_age || null,
                  a.droit_entree || null,
                  a.date_inscription || null,
                  b2i(a.archive),
                  a.date_archivage || null,
                  a.date_reactivation || null
                );
              }
            } catch (e) {
              console.warn('[sync] erreur import adhérent:', a?.email1, e?.message || e);
            }
          }
        });
        txA();
      } catch (e) {
        console.warn('[sync] import adhérents échoué:', e?.message || e);
      }
    }

    // 🔥 Importer les produits depuis Neon dans la base locale
    let produitsImported = 0;
    if (produits && produits.length > 0) {
      console.log(`[sync] pull: ${produits.length} produits reçus depuis Neon`);
    
      // Debug: afficher un exemple de produit reçu
      if (produits[0]) {
        console.log(`[sync] Exemple produit reçu:`, {
          nom: produits[0].nom,
          unite_id: produits[0].unite_id,
          categorie_id: produits[0].categorie_id
        });
      }
    
      // Préparer les mappings UUID → ID local pour unités, catégories, fournisseurs
      const getUniteIdByUuid = db.prepare('SELECT id FROM unites WHERE remote_uuid = ?');
      const getCategorieIdByUuid = db.prepare('SELECT id FROM categories WHERE remote_uuid = ?');
      const getFournisseurIdByUuid = db.prepare('SELECT id FROM fournisseurs WHERE remote_uuid = ?');
    
      // Préparer les updates de remote_uuid pour les entités qui n'en ont pas encore
      const updateUniteUuid = db.prepare('UPDATE unites SET remote_uuid = ? WHERE id = ?');
      const updateCategorieUuid = db.prepare('UPDATE categories SET remote_uuid = ? WHERE id = ?');
      const updateFournisseurUuid = db.prepare('UPDATE fournisseurs SET remote_uuid = ? WHERE id = ?');
    
      // Construire des maps UUID→Nom depuis le serveur pour fallback
      const unitesByUuid = new Map();
      const categoriesByUuid = new Map();
      const fournisseursByUuid = new Map();
    
      for (const u of unites) {
        unitesByUuid.set(u.id, u.nom);
      }
      for (const c of categories) {
        categoriesByUuid.set(c.id, c.nom);
      }
      for (const f of fournisseurs) {
        fournisseursByUuid.set(f.id, f.nom);
      }
    
      const checkStmt = db.prepare('SELECT id FROM produits WHERE remote_uuid = ?');
      const insertStmt = db.prepare(`
        INSERT INTO produits (remote_uuid, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      `);
      const updateStmt = db.prepare(`
        UPDATE produits SET
          nom = ?,
          reference = ?,
          prix = ?,
          code_barre = ?,
          unite_id = ?,
          fournisseur_id = ?,
          categorie_id = ?,
          updated_at = datetime('now','localtime')
        WHERE remote_uuid = ?
      `);

      for (const p of produits) {
        try {
          // Mapper UUID → ID local
          let uniteIdLocal = null;
          let categorieIdLocal = null;
          let fournisseurIdLocal = null;
        
          if (p.unite_id) {
            let unite = getUniteIdByUuid.get(p.unite_id);
            if (!unite) {
              // Fallback: chercher par nom si le remote_uuid n'est pas encore mappé
              const nomUnite = unitesByUuid.get(p.unite_id);
              if (nomUnite) {
                const uniteByName = db.prepare('SELECT id FROM unites WHERE nom = ?').get(nomUnite);
                if (uniteByName) {
                  unite = uniteByName;
                  // Mettre à jour le remote_uuid pour les prochaines fois
                  updateUniteUuid.run(p.unite_id, uniteByName.id);
                  console.log(`[sync] Unite "${nomUnite}" mappée: local_id=${uniteByName.id} ← uuid=${p.unite_id}`);
                }
              }
            }
            uniteIdLocal = unite?.id || null;
          }
        
          if (p.categorie_id) {
            let categorie = getCategorieIdByUuid.get(p.categorie_id);
            if (!categorie) {
              // Fallback: chercher par nom
              const nomCategorie = categoriesByUuid.get(p.categorie_id);
              if (nomCategorie) {
                const categorieByName = db.prepare('SELECT id FROM categories WHERE nom = ?').get(nomCategorie);
                if (categorieByName) {
                  categorie = categorieByName;
                  updateCategorieUuid.run(p.categorie_id, categorieByName.id);
                  console.log(`[sync] Categorie "${nomCategorie}" mappée: local_id=${categorieByName.id} ← uuid=${p.categorie_id}`);
                }
              }
            }
            categorieIdLocal = categorie?.id || null;
          }
        
          if (p.fournisseur_id) {
            let fournisseur = getFournisseurIdByUuid.get(p.fournisseur_id);
            if (!fournisseur) {
              // Fallback: chercher par nom
              const nomFournisseur = fournisseursByUuid.get(p.fournisseur_id);
              if (nomFournisseur) {
                const fournisseurByName = db.prepare('SELECT id FROM fournisseurs WHERE nom = ?').get(nomFournisseur);
                if (fournisseurByName) {
                  fournisseur = fournisseurByName;
                  updateFournisseurUuid.run(p.fournisseur_id, fournisseurByName.id);
                  console.log(`[sync] Fournisseur "${nomFournisseur}" mappé: local_id=${fournisseurByName.id} ← uuid=${p.fournisseur_id}`);
                }
              }
            }
            fournisseurIdLocal = fournisseur?.id || null;
          }
        
          // 🆕 Générer une référence par défaut si manquante (required NOT NULL)
          const reference = p.reference || `P-${p.id.substring(0, 8).toUpperCase()}`;
          
          const existing = checkStmt.get(p.id);
          if (existing) {
            // Toujours mettre à jour depuis le serveur (source de vérité pour nom, prix, etc.)
            // ⚠️ Le stock n'est JAMAIS mis à jour ici - géré exclusivement via stock_movements
            updateStmt.run(
              p.nom,
              reference,
              Number(p.prix || 0),
              p.code_barre || null,
              uniteIdLocal,
              fournisseurIdLocal,
              categorieIdLocal,
              p.id  // WHERE remote_uuid = ?
            );
          } else {
            // Insertion avec stock=0 (sera recalculé par stock_movements)
            insertStmt.run(
              p.id,           // remote_uuid
              p.nom,
              reference,
              Number(p.prix || 0),
              0,              // stock toujours 0 à l'insertion, recalculé après
              p.code_barre || null,
              uniteIdLocal,
              fournisseurIdLocal,
              categorieIdLocal
            );
          }
          produitsImported++;
        } catch (e) {
          console.warn('[sync] erreur import produit:', p.reference, e?.message || e);
        }
      }
      console.log(`[sync] pull: ${produitsImported} produits importés/mis à jour`);
    }

    // 🔥 Importer les stock_movements depuis Neon
    let movementsImported = 0;
    if (stock_movements && stock_movements.length > 0) {
      console.log(`[sync] pull: ${stock_movements.length} stock_movements reçus depuis Neon`);
    
      // Mapper produit UUID → ID local
      const getProduitIdByUuid = db.prepare('SELECT id FROM produits WHERE remote_uuid = ?');
    
      const checkMovement = db.prepare('SELECT 1 FROM stock_movements WHERE remote_uuid = ?');
      const insertMovement = db.prepare(`
        INSERT OR IGNORE INTO stock_movements (produit_id, delta, source, source_id, created_at, meta, remote_uuid)
        VALUES (?, ?, ?, ?, ?, '{}', ?)
      `);
    
      for (const m of stock_movements) {
        try {
          // Vérifier si le mouvement existe déjà (par son UUID serveur) - AVANT toute autre opération
          const exists = checkMovement.get(m.id);
          if (exists) {
            // Mouvement déjà présent, on skip
            continue;
          }
        
          // Résoudre le produit_id local
          const produitLocal = getProduitIdByUuid.get(m.produit_id);
          if (!produitLocal) {
            // Produit non trouvé localement, ignoré silencieusement
            continue;
          }
        
          // Insérer le mouvement (sans OR IGNORE car on a déjà checké)
          insertMovement.run(
            produitLocal.id,         // ID local du produit
            Number(m.delta || 0),
            m.source || 'unknown',
            m.source_id || null,
            m.created_at || new Date().toISOString(),
            m.id                     // UUID du serveur comme remote_uuid
          );
          movementsImported++;
        } catch (e) {
          console.warn('[sync] erreur import stock_movement:', m.id, e?.message || e);
        }
      }
      console.log(`[sync] pull: ${movementsImported} mouvements importés`);
      
      // 🔥 Recalculer les stocks de TOUS les produits depuis stock_movements (source de vérité)
      try {
        const produits = db.prepare('SELECT id FROM produits').all();
        const getStockFromMovements = db.prepare(`
          SELECT COALESCE(SUM(delta), 0) AS total 
          FROM stock_movements 
          WHERE produit_id = ?
        `);
        const updateStock = db.prepare('UPDATE produits SET stock = ? WHERE id = ?');
        
        let recalculated = 0;
        for (const p of produits) {
          const result = getStockFromMovements.get(p.id);
          const calculatedStock = Number(result?.total || 0);
          updateStock.run(calculatedStock, p.id);
          recalculated++;
        }
        console.log(`[sync] ${recalculated} stocks recalculés depuis stock_movements`);
      } catch (e) {
        console.warn('[sync] Erreur recalcul stocks:', e?.message || e);
      }
    }

    // 🔥 Importer les sessions d'inventaire depuis Neon (open + détection close)
    let sessionsImported = 0;
    let sessionsClosed = [];
    if (inventory_sessions && inventory_sessions.length > 0) {
      console.log(`[sync] pull: ${inventory_sessions.length} inventory_sessions reçues depuis Neon`);
      
      const checkSession = db.prepare('SELECT id, status FROM inventory_sessions WHERE remote_uuid = ?');
      const insertSession = db.prepare(`
        INSERT OR REPLACE INTO inventory_sessions (name, status, started_at, ended_at, remote_uuid)
        VALUES (?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        for (const s of inventory_sessions) {
          try {
            const exists = checkSession.get(s.id);
            const remoteStatus = (s.status || 'open').toLowerCase();
            
            // Détecter les sessions qui passent de 'open' à 'closed'
            if (exists && exists.status === 'open' && remoteStatus === 'closed') {
              sessionsClosed.push(s.id);
            }
            
            // Synchroniser toutes les sessions (open ou closed récents)
            insertSession.run(
              s.name || 'Inventaire',
              remoteStatus,
              s.started_at || new Date().toISOString(),
              s.ended_at || null,
              s.id  // UUID serveur
            );
            
            sessionsImported++;
          } catch (e) {
            console.warn('[sync] erreur import inventory_session:', s.id, e?.message || e);
          }
        }
      });
      tx();
      console.log(`[sync] pull: ${sessionsImported} inventory_sessions importées, ${sessionsClosed.length} fermées`);
      
      // Notifier les terminaux que des sessions ont été fermées
      if (sessionsClosed.length > 0) {
        for (const sessionId of sessionsClosed) {
          notifyRenderer('inventory:session-closed', { sessionId, closed: true, at: Date.now() });
        }
      }
    }

      // Ne plus émettre data:refreshed automatiquement pour éviter de perturber l'utilisateur
      // Les pages se rechargeront naturellement lors de la navigation ou au besoin
      // notifyRenderer('data:refreshed', { from: 'pull_refs' });
      
      // 📦 Mettre à jour le cache après l'import
      if (produits.length > 0) {
        cache.invalidateByPrefix('produits:');
      }
      if (categories.length > 0) {
        cache.invalidateByPrefix('categories:');
      }
      if (modes_paiement.length > 0) {
        cache.invalidateByPrefix('modes_paiement:');
      }
      if (fournisseurs.length > 0) {
        cache.invalidateByPrefix('fournisseurs:');
      }
      
      setState('online', { phase: 'pulled' });

      // 🔥 Mettre à jour le timestamp de la dernière sync réussie
      try {
        const serverTime = json.server_time || new Date().toISOString();
        db.prepare(`
          INSERT OR REPLACE INTO sync_state (entity_type, last_sync_at, last_sync_ok, updated_at)
          VALUES ('pull_refs', ?, 1, datetime('now'))
        `).run(serverTime);
        console.log('[sync] Timestamp de sync mis à jour:', serverTime);
      } catch (e) {
        console.warn('[sync] Erreur mise à jour sync_state pull_refs:', e?.message);
      }

      return {
        ok: true,
        sync_type: json.sync_type || 'full',
        counts: {
          unites: unites.length,
          familles: familles.length,
          categories: categories.length,
          adherents: adherents.length,
          fournisseurs: fournisseurs.length,
          produits: produits.length,
          modes_paiement: modes_paiement.length,
          inventory_sessions: sessionsImported,
      },
    };
  }, 'pullRefs');
}

/* -------------------------------------------------
   PULL VENTES (historique complet avec lignes)
   Support incrémental via since= timestamp + pagination
--------------------------------------------------*/
async function pullVentes({ since = null } = {}) {
  // Récupérer le dernier sync depuis sync_state si since non fourni
  if (!since) {
    try {
      const row = db.prepare('SELECT last_sync_at FROM sync_state WHERE entity_type = ?').get('ventes');
      since = row?.last_sync_at || null;
    } catch (e) {
      console.warn('[sync] Erreur lecture sync_state pour ventes:', e);
    }
  }

  setState('pulling');
  
  return await withRetry(async () => {
    let allVentes = [];
    let allLignesVente = [];
    let offset = 0;
    const limit = 1000; // Pagination: 1000 ventes par requête
    let hasMore = true;
    
    // 📊 Boucle de pagination
    while (hasMore) {
      const qs = new URLSearchParams();
      if (since) qs.append('since', since);
      qs.append('limit', limit);
      qs.append('offset', offset);
      
      let res;
      try {
        // Correction : ne pas écraser les headers d'auth, apiFetch les ajoute déjà
        // DEBUG : log headers envoyés
        const { getAuthHeader } = require('./apiClient');
        const debugHeaders = getAuthHeader();
        logger.info('sync', 'Headers API pullVentes', debugHeaders);
        res = await apiFetch(`/sync/pull_ventes?${qs.toString()}`, { 
          method: 'GET'
        });
      } catch (e) {
        const errorInfo = classifyNetworkError(e);
        logger.error('sync', 'pullVentes: erreur réseau', { error: String(e), type: errorInfo.type });
        setState('offline', { error: errorInfo.message });
        throw e;
      }

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        logger.error('sync', `pullVentes: HTTP ${res.status}`, { response: t });
        setState('offline', { error: `HTTP ${res.status}` });
        throw new Error(`pull_ventes ${res.status} ${t}`);
      }

      const json = await res.json();
      const { ventes = [], lignes_vente = [] } = json?.data || {};
      const meta = json?.meta || {};
      
      allVentes.push(...ventes);
      allLignesVente.push(...lignes_vente);
      
      hasMore = meta.hasMore || false;
      offset += limit;
      
      logger.info('sync', `pullVentes page: ${ventes.length} vente(s), total: ${allVentes.length}/${meta.total || '?'}`, { 
        offset: meta.offset,
        hasMore,
        elapsed: meta.elapsed_ms + 'ms'
      });
      
      // Limiter à 10000 ventes max pour éviter surcharge mémoire
      if (allVentes.length >= 10000) {
        console.warn('[sync] ⚠️  Limite de 10000 ventes atteinte, arrêt de la pagination');
        break;
      }
    }
    
    const timestamp = new Date().toISOString();
    const ventes = allVentes;
    const lignes_vente = allLignesVente;

    logger.info('sync', `pullVentes: ${ventes.length} vente(s) reçue(s)`, { since: since || 'null' });

    let ventesImported = 0;
    let lignesImported = 0;

    if (ventes.length > 0) {
      const checkVente = db.prepare('SELECT 1 FROM ventes WHERE remote_uuid = ?');
      const insertVente = db.prepare(`
        INSERT OR IGNORE INTO ventes (remote_uuid, adherent_id, date_vente, total, mode_paiement_id, sale_type, client_email, frais_paiement, cotisation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateVente = db.prepare(`
        UPDATE ventes SET adherent_id = ?, date_vente = ?, total = ?, mode_paiement_id = ?, sale_type = ?, client_email = ?, frais_paiement = ?, cotisation = ?, updated_at = ?
        WHERE remote_uuid = ? AND updated_at < ?
      `);

      for (const v of ventes) {
        try {
          // Vérifier que les FK existent
          if (v.adherent_id) {
            const adherentExists = db.prepare('SELECT 1 FROM adherents WHERE remote_uuid = ?').get(v.adherent_id);
            if (!adherentExists) {
              logger.warn('sync', 'Adhérent manquant pour vente', { vente_id: v.id, adherent_id: v.adherent_id });
              continue;
            }
          }
          if (v.mode_paiement_id) {
            const modeExists = db.prepare('SELECT 1 FROM modes_paiement WHERE remote_uuid = ?').get(v.mode_paiement_id);
            if (!modeExists) {
              logger.warn('sync', 'Mode paiement manquant pour vente', { vente_id: v.id, mode_paiement_id: v.mode_paiement_id });
              continue;
            }
          }

          const exists = checkVente.get(v.id);
          if (exists) {
            updateVente.run(
              v.adherent_id, 
              v.date_vente || v.created_at, 
              v.total, 
              v.mode_paiement_id, 
              v.sale_type || 'adherent', 
              v.client_email, 
              v.frais_paiement || 0, 
              v.cotisation || 0, 
              v.updated_at, 
              v.id, 
              v.updated_at
            );
          } else {
            insertVente.run(
              v.id, 
              v.adherent_id, 
              v.date_vente || v.created_at, 
              v.total, 
              v.mode_paiement_id, 
              v.sale_type || 'adherent', 
              v.client_email, 
              v.frais_paiement || 0, 
              v.cotisation || 0, 
              v.created_at, 
              v.updated_at
            );
          }
          ventesImported++;
        } catch (e) {
          logger.warn('sync', 'Erreur import vente', { vente_id: v.id, error: e?.message });
        }
      }
    }

    if (lignes_vente.length > 0) {
      const checkLigne = db.prepare('SELECT 1 FROM lignes_vente WHERE remote_uuid = ?');
      const insertLigne = db.prepare(`
        INSERT OR IGNORE INTO lignes_vente (remote_uuid, vente_id, produit_id, quantite, prix_unitaire)
        VALUES (?, (SELECT id FROM ventes WHERE remote_uuid = ?), (SELECT id FROM produits WHERE remote_uuid = ?), ?, ?)
      `);

      for (const ligne of lignes_vente) {
        try {
          const exists = checkLigne.get(ligne.id);
          if (!exists) {
            insertLigne.run(ligne.id, ligne.vente_id, ligne.produit_id, ligne.quantite, ligne.prix_unitaire);
            lignesImported++;
          }
        } catch (e) {
          logger.warn('sync', 'Erreur import ligne_vente', { ligne_id: ligne.id, error: e?.message });
        }
      }
    }

    // Mettre à jour sync_state
    try {
      db.prepare(`
        INSERT OR REPLACE INTO sync_state (entity_type, last_sync_at, last_sync_ok, updated_at)
        VALUES (?, ?, 1, datetime('now','localtime'))
      `).run('ventes', timestamp);
    } catch (e) {
      logger.warn('sync', 'Erreur mise à jour sync_state ventes', { error: e?.message });
    }

    logger.info('sync', `pullVentes terminé: ${ventesImported} ventes, ${lignesImported} lignes`);
    setState('online', { phase: 'ventes_pulled' });

    return {
      ok: true,
      counts: { ventes: ventesImported, lignes: lignesImported },
    };
  }, 'pullVentes');
}

/* -------------------------------------------------
   PULL RECEPTIONS (historique complet avec lignes)
   Support incrémental via since= timestamp + pagination
--------------------------------------------------*/
async function pullReceptions({ since = null } = {}) {
  if (!since) {
    try {
      const row = db.prepare('SELECT last_sync_at FROM sync_state WHERE entity_type = ?').get('receptions');
      since = row?.last_sync_at || null;
    } catch (e) {
      console.warn('[sync] Erreur lecture sync_state pour receptions:', e);
    }
  }

  setState('pulling');
  
  return await withRetry(async () => {
    let allReceptions = [];
    let allLignesReception = [];
    let offset = 0;
    const limit = 1000; // Pagination: 1000 réceptions par requête
    let hasMore = true;
    
    // 📊 Boucle de pagination
    while (hasMore) {
      const qs = new URLSearchParams();
      if (since) qs.append('since', since);
      qs.append('limit', limit);
      qs.append('offset', offset);
      
      let res;
      try {
        // Correction : ne pas écraser les headers d'auth, apiFetch les ajoute déjà
        res = await apiFetch(`/sync/pull_receptions?${qs.toString()}`, { 
          method: 'GET'
        });
      } catch (e) {
        const errorInfo = classifyNetworkError(e);
        logger.error('sync', 'pullReceptions: erreur réseau', { error: String(e), type: errorInfo.type });
        setState('offline', { error: errorInfo.message });
        throw e;
      }

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        logger.error('sync', `pullReceptions: HTTP ${res.status}`, { response: t });
        setState('offline', { error: `HTTP ${res.status}` });
        throw new Error(`pull_receptions ${res.status} ${t}`);
      }

      const json = await res.json();
      const { receptions = [], lignes_reception = [] } = json?.data || {};
      const meta = json?.meta || {};
      
      allReceptions.push(...receptions);
      allLignesReception.push(...lignes_reception);
      
      hasMore = meta.hasMore || false;
      offset += limit;
      
      logger.info('sync', `pullReceptions page: ${receptions.length} réception(s), total: ${allReceptions.length}/${meta.total || '?'}`, { 
        offset: meta.offset,
        hasMore,
        elapsed: meta.elapsed_ms + 'ms'
      });
      
      // Limiter à 10000 réceptions max pour éviter surcharge mémoire
      if (allReceptions.length >= 10000) {
        console.warn('[sync] ⚠️  Limite de 10000 réceptions atteinte, arrêt de la pagination');
        break;
      }
    }
    
    const timestamp = new Date().toISOString();
    const receptions = allReceptions;
    const lignes_reception = allLignesReception;

    logger.info('sync', `pullReceptions: ${receptions.length} réception(s) reçue(s)`, { since: since || 'null' });

    let receptionsImported = 0;
    let lignesImported = 0;

    if (receptions.length > 0) {
      const checkReception = db.prepare('SELECT 1 FROM receptions WHERE remote_uuid = ?');
      const insertReception = db.prepare(`
        INSERT OR IGNORE INTO receptions (remote_uuid, fournisseur_id, date, reference, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const updateReception = db.prepare(`
        UPDATE receptions SET fournisseur_id = ?, date = ?, reference = ?, updated_at = ?
        WHERE remote_uuid = ? AND updated_at < ?
      `);

      for (const r of receptions) {
        try {
          const exists = checkReception.get(r.id);
          if (exists) {
            updateReception.run(r.fournisseur_id, r.date, r.reference, r.updated_at, r.id, r.updated_at);
          } else {
            insertReception.run(r.id, r.fournisseur_id, r.date, r.reference, r.updated_at);
          }
          receptionsImported++;
        } catch (e) {
          logger.warn('sync', 'Erreur import reception', { reception_id: r.id, error: e?.message });
        }
      }
    }

    if (lignes_reception.length > 0) {
      const checkLigne = db.prepare('SELECT 1 FROM lignes_reception WHERE remote_uuid = ?');
      const insertLigne = db.prepare(`
        INSERT OR IGNORE INTO lignes_reception (remote_uuid, reception_id, produit_id, quantite, prix_unitaire)
        VALUES (?, (SELECT id FROM receptions WHERE remote_uuid = ?), (SELECT id FROM produits WHERE remote_uuid = ?), ?, ?)
      `);

      for (const ligne of lignes_reception) {
        try {
          const exists = checkLigne.get(ligne.id);
          if (!exists) {
            insertLigne.run(ligne.id, ligne.reception_id, ligne.produit_id, ligne.quantite, ligne.prix_unitaire);
            lignesImported++;
          }
        } catch (e) {
          logger.warn('sync', 'Erreur import ligne_reception', { ligne_id: ligne.id, error: e?.message });
        }
      }
    }

    // Mettre à jour sync_state
    try {
      db.prepare(`
        INSERT OR REPLACE INTO sync_state (entity_type, last_sync_at, last_sync_ok, updated_at)
        VALUES (?, ?, 1, datetime('now','localtime'))
      `).run('receptions', timestamp);
    } catch (e) {
      logger.warn('sync', 'Erreur mise à jour sync_state receptions', { error: e?.message });
    }

    logger.info('sync', `pullReceptions terminé: ${receptionsImported} réceptions, ${lignesImported} lignes`);
    setState('online', { phase: 'receptions_pulled' });

    return {
      ok: true,
      counts: { receptions: receptionsImported, lignes: lignesImported },
    };
  }, 'pullReceptions');
}

/* -------------------------------------------------
   OPS queue → push vers Neon
--------------------------------------------------*/
function takePendingOps(limit = 1000) {
  return db
    .prepare(
      `
    SELECT id, device_id, op_type, entity_type, entity_id, payload_json
    FROM ops_queue WHERE ack = 0 ORDER BY created_at ASC LIMIT ?
  `
    )
    .all(limit);
}

function countPendingOps() {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0`)
    .get();
  return r?.n || 0;
}

/**
 * Pousse immédiatement les opérations en file.
 * - deviceId: identifiant de ce poste (par défaut = DEVICE_ID)
 * - options.skipPull: si true, n'appelle PAS pullRefs() après le push
 */
async function pushOpsNow(deviceId = DEVICE_ID, options = {}) {
  const { skipPull = false } = options || {};

  const ops = takePendingOps(200);
  if (ops.length === 0) {
    logger.debug('sync', 'pushOpsNow: aucune opération en attente');
    setState('online', { phase: 'idle', pending: 0 });
    return { ok: true, sent: 0, pending: 0 };
  }

  logger.info('sync', `pushOpsNow: ${ops.length} opération(s) à envoyer`);
  setState('pushing', { pending: ops.length });

  const normalizeOpId = (raw) => {
    const s = (raw ?? '').toString().trim();
    if (isUuid(s)) return s;

    const n = Number(s);
    const hex = Number.isFinite(n) ? n.toString(16) : '0';
    const suffix = hex.padStart(12, '0').slice(-12);
    return `00000000-0000-0000-0000-${suffix}`;
  };

  const idsForOps = ops.map((o) => o.id);
  const payload = {
    deviceId,
    ops: ops.map((o) => ({
      id: normalizeOpId(o.id),
      op_type: o.op_type,
      entity_type: o.entity_type,
      entity_id: isUuid(o.entity_id) ? o.entity_id : null,
      payload_json: o.payload_json,
    })),
  };

  let res;
  try {
    res = await withRetry(async () => {
      return await apiFetch('/sync/push_ops', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }, 'pushOpsNow');
  } catch (e) {
    const err = String(e);
    const errorInfo = classifyNetworkError(e);
    logger.error('sync', 'pushOpsNow: échec après retries', { 
      error: err, 
      type: errorInfo.type,
      message: errorInfo.message,
      opsCount: ops.length 
    });
    try {
      const upd = db.prepare(
        `UPDATE ops_queue SET retry_count = COALESCE(retry_count,0) + 1, last_error = ?, failed_at = datetime('now','localtime') WHERE id IN (${idsForOps.map(() => '?').join(',')})`
      );
      upd.run(errorInfo.message, ...idsForOps);
    } catch (ee) {
      logger.warn('sync', 'pushOpsNow: échec marquage retry', { error: ee?.message || ee });
    }
    setState('offline', { error: errorInfo.message, pending: countPendingOps() });
    return { ok: false, error: errorInfo.message, pending: countPendingOps() };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = `HTTP ${res.status} ${txt}`;
    try {
      const upd2 = db.prepare(
        `UPDATE ops_queue SET retry_count = COALESCE(retry_count,0) + 1, last_error = ?, failed_at = datetime('now','localtime') WHERE id IN (${idsForOps.map(() => '?').join(',')})`
      );
      upd2.run(err, ...idsForOps);
    } catch (ee) {
      console.warn('[sync] failed to mark ops retry after HTTP error:', ee?.message || ee);
    }
    setState('offline', {
      error: `HTTP ${res.status}`,
      pending: countPendingOps(),
    });
    return {
      ok: false,
      error: err,
      pending: countPendingOps(),
    };
  }

  // 🧠 Nouveau : tenter de lire le JSON de réponse pour récupérer les mappings
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  // Si le serveur renvoie des mappings produits, on met à jour produits.remote_uuid en local
  try {
    if (body && body.mappings && Array.isArray(body.mappings.produits)) {
      const stmt = db.prepare(
        `UPDATE produits
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );

      for (const m of body.mappings.produits) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;

        try {
          stmt.run(remoteUuid, localId);
          console.log('[sync] remote_uuid mis à jour en local', {
            localId,
            remoteUuid,
          });
        } catch (e) {
          console.warn('[sync] erreur UPDATE produits.remote_uuid:', e?.message || e);
        }
      }
    }
    // Si le serveur renvoie des mappings pour inventory_sessions, on met à jour inventory_sessions.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.inventory_sessions)) {
      const stmtSess = db.prepare(
        `UPDATE inventory_sessions
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.inventory_sessions) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtSess.run(remoteUuid, localId);
          console.log('[sync] inventory_sessions.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE inventory_sessions.remote_uuid:', e?.message || e);
        }
      }
    }
    
    // 🔥 Si le serveur renvoie des mappings pour ventes, on met à jour ventes.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.ventes)) {
      const stmtVente = db.prepare(
        `UPDATE ventes
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.ventes) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtVente.run(remoteUuid, localId);
          console.log('[sync] ventes.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE ventes.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour adherents, on met à jour adherents.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.adherents)) {
      const stmtAdherent = db.prepare(
        `UPDATE adherents
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.adherents) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtAdherent.run(remoteUuid, localId);
          console.log('[sync] adherents.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE adherents.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour fournisseurs, on met à jour fournisseurs.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.fournisseurs)) {
      const stmtFournisseur = db.prepare(
        `UPDATE fournisseurs
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.fournisseurs) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtFournisseur.run(remoteUuid, localId);
          console.log('[sync] fournisseurs.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE fournisseurs.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour receptions, on met à jour receptions.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.receptions)) {
      const stmtReception = db.prepare(
        `UPDATE receptions
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.receptions) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtReception.run(remoteUuid, localId);
          console.log('[sync] receptions.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE receptions.remote_uuid:', e?.message || e);
        }
      }
    }

    // 🔥 Si le serveur renvoie des mappings pour fournisseurs, on met à jour fournisseurs.remote_uuid
    if (body && body.mappings && Array.isArray(body.mappings.fournisseurs)) {
      const stmtFournisseur = db.prepare(
        `UPDATE fournisseurs
            SET remote_uuid = ?
          WHERE id = ?
            AND (remote_uuid IS NULL OR remote_uuid = '')`
      );
      for (const m of body.mappings.fournisseurs) {
        if (!m) continue;
        const localId = Number(m.local_id);
        const remoteUuid = m.remote_uuid;
        if (!localId || !remoteUuid) continue;
        try {
          stmtFournisseur.run(remoteUuid, localId);
          console.log('[sync] fournisseurs.remote_uuid mis à jour en local', { localId, remoteUuid });
        } catch (e) {
          console.warn('[sync] erreur UPDATE fournisseurs.remote_uuid:', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[sync] traitement des mappings échoué:', e?.message || e);
  }

  const ids = ops.map((o) => o.id);
  db.prepare(
    `UPDATE ops_queue
      SET ack = 1,
        sent_at = datetime('now','localtime'),
        retry_count = 0,
        last_error = NULL,
        failed_at = NULL
      WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);

  notifyRenderer('ops:pushed', { count: ids.length });

  if (!skipPull) {
    try {
      await pullRefs();
    } catch (e) {
      setState('online', { phase: 'pull_failed', error: String(e) });
    }
  }

  const left = countPendingOps();
  setState('online', { phase: 'idle', pending: left });
  return { ok: true, sent: ids.length, pending: left };
}




/**
 * 🔁 Background sync déclenché après une action (création / modif / vente, etc.)
 * On l’exporte pour que les DB puissent l’appeler.
 */
let _bgSyncInFlight = false;
function triggerBackgroundSync(deviceId = DEVICE_ID) {
  if (_bgSyncInFlight) return;
  _bgSyncInFlight = true;

  setImmediate(async () => {
    try {
      await pushOpsNow(deviceId);
    } catch (_) {
      // on ne casse jamais l’UI sur une erreur réseau ici
    } finally {
      _bgSyncInFlight = false;
    }
  });
}

// Auto sync loop control
let _autoSyncTimer = null;
let _autoPullTimer = null;
let _autoSyncIntervalMs = 5000; // valeur de base

function jitter(ms) {
  // jitter +/- 20%
  const frac = 0.2;
  const delta = Math.floor(ms * frac);
  return ms - delta + Math.floor(Math.random() * (delta * 2 + 1));
}

/**
 * Démarre l'auto-sync qui adapte l'intervalle selon l'échec des ops.
 * Backoff exponentiel basé sur le retry_count maximum présent dans la file.
 * Effectue aussi un pull périodique toutes les 10 secondes.
 */
function startAutoSync(deviceId = DEVICE_ID) {
  // clear existing timers
  if (_autoSyncTimer) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = null;
  }
  if (_autoPullTimer) {
    clearTimeout(_autoPullTimer);
    _autoPullTimer = null;
  }

  const MAX_RETRY_ATTEMPTS = 5;
  const BASE_INTERVAL_MS = 5000; // 5s pour push
  const PULL_INTERVAL_MS = 10000; // 10s pour pull
  const MAX_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Fonction de pull automatique périodique
  async function runPullCycle() {
    try {
      await pullRefs();
    } catch (e) {
      console.warn('[sync] auto-pull error:', e?.message || e);
    } finally {
      // Reprogrammer le prochain pull
      _autoPullTimer = setTimeout(runPullCycle, PULL_INTERVAL_MS);
    }
  }

  async function runOnce() {
    try {
      // Count pending
      const pending = countPendingOps();
      if (pending === 0) {
        setState('online', { phase: 'idle', pending: 0 });
        // schedule next check at base interval
        _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
        return;
      }

      // get max retry_count among pending ops
      let maxRetry = 0;
      try {
        const row = db.prepare('SELECT MAX(COALESCE(retry_count,0)) AS m FROM ops_queue WHERE ack = 0').get();
        maxRetry = row?.m || 0;
      } catch (e) {
        maxRetry = 0;
      }

      if (maxRetry >= MAX_RETRY_ATTEMPTS) {
        // Too many retries — don't auto-retry these ops, notify UI and sleep longer
        const row = db.prepare('SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0 AND COALESCE(retry_count,0) >= ?').get(MAX_RETRY_ATTEMPTS);
        const countBlocked = row?.n || 0;
        notifyRenderer('sync:failed_limit', { count: countBlocked });
        // schedule next check after a longer interval
        _autoSyncTimer = setTimeout(runOnce, MAX_INTERVAL_MS);
        return;
      }

      // compute backoff delay based on maxRetry
      const delay = Math.min(MAX_INTERVAL_MS, BASE_INTERVAL_MS * Math.pow(2, Math.max(0, maxRetry)));
      const delayWithJitter = jitter(delay);

      // If retry_count is zero we can push immediately, otherwise wait the backoff
      if (maxRetry === 0) {
        // try push now
        await pushOpsNow(deviceId).catch(() => {});
        _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
      } else {
        // schedule next push after computed backoff
        _autoSyncTimer = setTimeout(async () => {
          try {
            await pushOpsNow(deviceId).catch(() => {});
          } finally {
            // schedule next run after base interval
            _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
          }
        }, delayWithJitter);
      }
    } catch (e) {
      console.warn('[sync] startAutoSync error:', e?.message || e);
      _autoSyncTimer = setTimeout(runOnce, BASE_INTERVAL_MS);
    }
  }

  // kick both cycles
  runOnce(); // Push cycle
  runPullCycle(); // Pull cycle
}

function stopAutoSync() {
  if (_autoSyncTimer) {
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = null;
  }
  if (_autoPullTimer) {
    clearTimeout(_autoPullTimer);
    _autoPullTimer = null;
  }
}

/* -------------------------------------------------
   BOOTSTRAP / HYDRATE
--------------------------------------------------*/
function collectLocalRefs() {
  const exists = (table, id) => {
    const n = asIntOrNull(id);
    if (n == null) return false;
    try {
      const r = db
        .prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`)
        .get(n);
      return !!r;
    } catch {
      return false;
    }
  };

  const all = (sql) => db.prepare(sql).all();

  const unites = all(`SELECT id, nom FROM unites ORDER BY id`);
  const familles = all(`SELECT id, nom FROM familles ORDER BY id`);
  const categories = all(
    `SELECT id, nom, famille_id FROM categories ORDER BY id`
  );
  const adherents = all(`
    SELECT id, nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
           nb_personnes_foyer, tranche_age, droit_entree, date_inscription, archive, date_archivage, date_reactivation
    FROM adherents ORDER BY id
  `);
  const fournisseurs = all(`
    SELECT id, nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label
    FROM fournisseurs ORDER BY id
  `).map((f) => ({
    ...f,
    categorie_id: exists('categories', f.categorie_id) ? f.categorie_id : null,
    referent_id: exists('adherents', f.referent_id) ? f.referent_id : null,
  }));

  const produits = all(`
    SELECT remote_uuid, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id, updated_at
    FROM produits ORDER BY id
  `).map((p) => ({
    ...p,
    id: p.remote_uuid || null, // Utiliser remote_uuid comme ID pour le bootstrap
    unite_id: exists('unites', p.unite_id) ? p.unite_id : null,
    fournisseur_id: exists('fournisseurs', p.fournisseur_id)
      ? p.fournisseur_id
      : null,
    categorie_id: exists('categories', p.categorie_id) ? p.categorie_id : null,
  })).filter(p => p.id); // Ignorer les produits sans remote_uuid (pas encore sync)

  const modes_paiement = all(
    `SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id`
  );

  return {
    unites,
    familles,
    categories,
    adherents,
    fournisseurs,
    produits,
    modes_paiement,
  };
}

// ⚠️ On garde bootstrapIfNeeded pour un usage manuel/exceptionnel,
// mais on NE L’APPELLE PLUS automatiquement au démarrage.
async function bootstrapIfNeeded() {
  let needed = false;
  try {
    const r = await apiFetch('/sync/bootstrap_needed', { method: 'GET' });
    if (r.ok) {
      const j = await r.json();
      needed = !!j?.needed;
    } else {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `bootstrap_needed HTTP ${r.status} ${t}` };
    }
  } catch (e) {
    setState('offline', { error: String(e) });
    return { ok: false, error: String(e) };
  }

  if (!needed) return { ok: true, bootstrapped: false };

  const refs = collectLocalRefs();
  let resp;
  try {
    resp = await apiFetch('/sync/bootstrap', {
      method: 'POST',
      body: JSON.stringify(refs),
    });
  } catch (e) {
    setState('offline', { error: String(e) });
    return { ok: false, error: String(e) };
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    setState('offline', { error: `HTTP ${resp.status}` });
    return { ok: false, error: `HTTP ${resp.status} ${txt}` };
  }

  const js = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: js?.counts || {} });

  try {
    await pullRefs();
  } catch (_) {}

  return { ok: true, bootstrapped: true, counts: js?.counts || {} };
}

// 🆕 Version simple : au démarrage, on fait juste un pull
// (le bootstrap automatique est géré ailleurs ou manuellement)
async function hydrateOnStartup() {
  setState('pulling', { phase: 'startup' });
  const r = await pullRefs();
  setState('online', { phase: 'startup_done' });
  return r;
}

async function pullAll() {
  try {
    logger.info('sync', 'pullAll: début synchronisation complète');
    
    // Pull dans l'ordre : refs → ventes → réceptions
    await pullRefs();
    await pullVentes();
    await pullReceptions();
    
    logger.info('sync', 'pullAll: synchronisation complète terminée');
    notifyRenderer('data:refreshed', { from: 'pullAll' });
    
    return { ok: true };
  } catch (e) {
    logger.error('sync', 'pullAll: erreur', { error: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e) };
  }
}

/* Auto-sync handled by startAutoSync/stopAutoSync (custom backoff/jitter).
   Functions `startAutoSync` and `stopAutoSync` are defined earlier in the file
   to provide exponential backoff with jitter based on per-op retry_count. */

/* -------------------------------------------------
   Export public
--------------------------------------------------*/
async function pushBootstrapRefs() {
  const refs = collectLocalRefs();
  const resp = await apiFetch('/sync/bootstrap', {
    method: 'POST',
    body: JSON.stringify(refs),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`bootstrap HTTP ${resp.status} ${txt}`);
  }
  const js = await resp.json().catch(() => ({}));
  notifyRenderer('data:bootstrapped', { counts: js?.counts || {} });
  await pullRefs();
  return { ok: true, counts: js?.counts || {} };
}

// Remplace l’ancienne version de syncPushAll par celle-ci
async function syncPushAll(deviceId = DEVICE_ID) {
  try {
    // 1) push des opérations en attente
    const pushRes = await pushOpsNow(deviceId);

    // 2) puis pull complet pour rafraîchir les refs
    let pullRes = null;
    try {
      pullRes = await pullRefs();
    } catch (e) {
      setState('online', {
        phase: 'pull_failed_after_push_all',
        error: String(e),
      });
    }

    setState('online', { phase: 'idle', pending: countPendingOps() });
    return {
      ok: true,
      push: pushRes,
      pull: pullRes,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Reset retry_count pour les ops en échec et relance un push
 * @param {number[]} ids - IDs spécifiques à reset (optionnel, sinon toutes les ops en échec)
 */
async function retryFailedOps(ids = null) {
  try {
    let resetCount = 0;
    
    if (ids && Array.isArray(ids) && ids.length > 0) {
      // Reset des IDs spécifiques
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE ops_queue 
        SET retry_count = 0, last_error = NULL, failed_at = NULL 
        WHERE id IN (${placeholders}) AND ack = 0
      `);
      const result = stmt.run(...ids);
      resetCount = result.changes || 0;
    } else {
      // Reset de toutes les ops en échec (retry_count > 0)
      const stmt = db.prepare(`
        UPDATE ops_queue 
        SET retry_count = 0, last_error = NULL, failed_at = NULL 
        WHERE ack = 0 AND COALESCE(retry_count, 0) > 0
      `);
      const result = stmt.run();
      resetCount = result.changes || 0;
    }
    
    console.log(`[sync] Reset de ${resetCount} opération(s) en échec`);
    
    // Relancer un push immédiatement
    const pushRes = await pushOpsNow(getDeviceId());
    
    return {
      ok: true,
      reset: resetCount,
      push: pushRes,
    };
  } catch (e) {
    console.error('[sync] Erreur retryFailedOps:', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  hydrateOnStartup,
  pullRefs,
  pullVentes,
  pullReceptions,
  pullAll,
  pushOpsNow,
  startAutoSync,
  stopAutoSync,
  countPendingOps,
  pushBootstrapRefs,
  syncPushAll,
  triggerBackgroundSync,
  retryFailedOps,
};
