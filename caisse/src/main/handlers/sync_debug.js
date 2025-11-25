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
   * sync:failed_ops
   * -> renvoie les ops en erreur (retry_count > 0 et ack = 0)
   */
  safeHandle('sync:failed_ops', async () => {
    try {
      const rows = db
        .prepare(
          `SELECT id, device_id, created_at, op_type, entity_type, entity_id, payload_json, retry_count, last_error, failed_at FROM ops_queue WHERE ack = 0 AND retry_count > 0 ORDER BY failed_at DESC LIMIT 200`
        )
        .all();
      return { ok: true, rows };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
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

  /**
   * sync:retry_failed
   * -> réinitialise retry_count/last_error/failed_at pour les ops en erreur
   *    si un tableau d'ids est passé, ne concerne que ces ids.
   * -> lance un push immédiat via sync.pushOpsNow()
   */
  safeHandle('sync:retry_failed', async (_event, ids) => {
    try {
      let rows = 0;
      if (Array.isArray(ids) && ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const res = db
          .prepare(
            `UPDATE ops_queue SET retry_count = 0, last_error = NULL, failed_at = NULL WHERE ack = 0 AND id IN (${placeholders})`
          )
          .run(...ids);
        rows = res?.changes || 0;
      } else {
        const res = db
          .prepare(
            `UPDATE ops_queue SET retry_count = 0, last_error = NULL, failed_at = NULL WHERE ack = 0 AND COALESCE(retry_count,0) > 0`
          )
          .run();
        rows = res?.changes || 0;
      }

      let pushRes = null;
      if (typeof sync.pushOpsNow === 'function') {
        pushRes = await sync.pushOpsNow();
      }

      return { ok: true, reset: rows, push: pushRes };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

module.exports = registerSyncDebug;
