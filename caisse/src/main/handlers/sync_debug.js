// src/main/handlers/sync_debug.js
'use strict';

const db = require('../db/db');
const sync = require('../sync');

function registerSyncDebug(ipcMain) {
  if (!ipcMain) return;

  const safeHandle = (channel, handler) => {
    try { ipcMain.removeHandler(channel); } catch (_) {}
    ipcMain.handle(channel, handler);
  };

  /**
   * sync:status
   *  -> utilisé par la page Paramètres > Synchronisation
   *  -> renvoie le nombre d'ops EN ATTENTE (ack = 0)
   */
  safeHandle('sync:status', async () => {
    try {
      let queue = 0;

      if (typeof sync.countPendingOps === 'function') {
        // on utilise le helper du module sync.js si dispo
        queue = await sync.countPendingOps();
      } else {
        // fallback : comptage direct en SQL
        const row = db
          .prepare('SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0')
          .get();
        queue = row?.n || 0;
      }

      return {
        ok: true,
        queue,
        when: new Date().toISOString(),
      };
    } catch (e) {
      return {
        ok: false,
        error: e?.message || String(e),
      };
    }
  });

  /**
   * sync:drain
   *  -> appelé par le bouton "Pousser maintenant"
   *  -> vide la file d'attente via sync.pushOpsNow()
   */
  safeHandle('sync:drain', async () => {
    try {
      if (typeof sync.pushOpsNow !== 'function') {
        return { ok: false, error: 'pushOpsNow indisponible' };
      }

      const res = await sync.pushOpsNow(); // appelle /sync/push_ops
      let left = 0;

      if (typeof sync.countPendingOps === 'function') {
        left = await sync.countPendingOps();
      } else {
        const row = db
          .prepare('SELECT COUNT(*) AS n FROM ops_queue WHERE ack = 0')
          .get();
        left = row?.n || 0;
      }

      return {
        ok: !!res?.ok,
        ...res,
        queue: left,
      };
    } catch (e) {
      return {
        ok: false,
        error: e?.message || String(e),
      };
    }
  });
}

module.exports = registerSyncDebug;
