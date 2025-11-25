// src/main/importServerRefs.js
'use strict';

const db = require('./db/db');
const { apiFetch } = require('./apiClient');

/**
 * Importe les références (unités, familles, catégories, modes de paiement)
 * depuis le serveur (GET /sync/pull_refs) vers la base locale SQLite.
 * 
 * N'écrase pas les données locales existantes (ON CONFLICT DO NOTHING sur nom)
 * 
 * @returns {Promise<{ok: boolean, counts?: object, error?: string}>}
 */
async function importServerRefsToLocal() {
  try {
    console.log('[importServerRefs] Appel GET /sync/pull_refs...');
    
    const res = await apiFetch('/sync/pull_refs', { method: 'GET' });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = `HTTP ${res.status}: ${text}`;
      console.error('[importServerRefs] Erreur:', error);
      return { ok: false, error };
    }

    const json = await res.json();
    const data = json?.data || {};
    
    const {
      unites = [],
      familles = [],
      categories = [],
      modes_paiement = [],
    } = data;

    console.log('[importServerRefs] Données reçues:', {
      unites: unites.length,
      familles: familles.length,
      categories: categories.length,
      modes_paiement: modes_paiement.length,
    });

    // Préparation des statements
    const insertUnite = db.prepare(`
      INSERT INTO unites (remote_uuid, nom)
      VALUES (?, ?)
      ON CONFLICT (nom) DO UPDATE SET remote_uuid = excluded.remote_uuid
    `);

    const insertFamille = db.prepare(`
      INSERT INTO familles (remote_uuid, nom)
      VALUES (?, ?)
      ON CONFLICT (nom) DO UPDATE SET remote_uuid = excluded.remote_uuid
      RETURNING id
    `);

    const getFamilleIdByUuid = db.prepare(`
      SELECT id FROM familles WHERE remote_uuid = ?
    `);

    const insertCategorie = db.prepare(`
      INSERT INTO categories (remote_uuid, nom, famille_id)
      VALUES (?, ?, ?)
      ON CONFLICT (nom, famille_id) DO UPDATE SET remote_uuid = excluded.remote_uuid
    `);

    const insertMode = db.prepare(`
      INSERT INTO modes_paiement (remote_uuid, nom, taux_percent, frais_fixe, actif)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (nom) DO UPDATE SET 
        taux_percent = excluded.taux_percent,
        frais_fixe = excluded.frais_fixe,
        actif = excluded.actif,
        remote_uuid = excluded.remote_uuid
    `);

    let counts = {
      unites: 0,
      familles: 0,
      categories: 0,
      modes_paiement: 0,
    };

    // Map pour convertir UUID famille serveur → id local
    const familleUuidToLocalId = new Map();

    // Transaction pour tout insérer d'un coup
    const transaction = db.transaction(() => {
      // Unités
      for (const u of unites) {
        if (!u.nom) continue;
        try {
          const info = insertUnite.run(u.id || null, u.nom);
          if (info.changes > 0) counts.unites++;
        } catch (e) {
          console.warn('[importServerRefs] Erreur insert unité:', u.nom, e.message);
        }
      }

      // Familles (on récupère l'id local après insert)
      for (const f of familles) {
        if (!f.nom) continue;
        try {
          const info = insertFamille.run(f.id || null, f.nom);
          if (info.changes > 0) {
            counts.familles++;
            // Récupérer l'id local de la famille nouvellement insérée
            const localId = info.lastInsertRowid;
            if (f.id && localId) {
              familleUuidToLocalId.set(f.id, localId);
            }
          } else {
            // Famille existe déjà, on récupère son id via UUID
            if (f.id) {
              const existing = getFamilleIdByUuid.get(f.id);
              if (existing?.id) {
                familleUuidToLocalId.set(f.id, existing.id);
              }
            }
          }
        } catch (e) {
          console.warn('[importServerRefs] Erreur insert famille:', f.nom, e.message);
        }
      }

      // Catégories (on convertit famille_id UUID → id local)
      for (const c of categories) {
        if (!c.nom) continue;
        try {
          let localFamilleId = null;
          if (c.famille_id && familleUuidToLocalId.has(c.famille_id)) {
            localFamilleId = familleUuidToLocalId.get(c.famille_id);
          }
          const info = insertCategorie.run(c.id || null, c.nom, localFamilleId);
          if (info.changes > 0) counts.categories++;
        } catch (e) {
          console.warn('[importServerRefs] Erreur insert catégorie:', c.nom, 'famille_id:', c.famille_id, e.message);
        }
      }

      // Modes de paiement
      for (const mp of modes_paiement) {
        if (!mp.nom) continue;
        try {
          const taux = Number(mp.taux_percent) || 0;
          const frais = Number(mp.frais_fixe) || 0;
          const actif = mp.actif ? 1 : 0;
          const info = insertMode.run(mp.id || null, mp.nom, taux, frais, actif);
          if (info.changes > 0) counts.modes_paiement++;
        } catch (e) {
          console.warn('[importServerRefs] Erreur insert mode paiement:', mp.nom, e.message);
        }
      }
    });

    transaction();

    console.log('[importServerRefs] Import terminé:', counts);

    return {
      ok: true,
      counts,
      total: counts.unites + counts.familles + counts.categories + counts.modes_paiement,
    };
  } catch (e) {
    console.error('[importServerRefs] Exception:', e);
    return {
      ok: false,
      error: e?.message || String(e),
    };
  }
}

/**
 * Vérifie si la base locale a déjà des catégories
 * @returns {boolean} true si la base est vide (pas de catégories)
 */
function isLocalDbEmpty() {
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM categories').get();
    return (row?.n || 0) === 0;
  } catch (e) {
    console.warn('[importServerRefs] isLocalDbEmpty error:', e.message);
    return true; // en cas d'erreur, on considère qu'elle est vide
  }
}

module.exports = { importServerRefsToLocal, isLocalDbEmpty };
