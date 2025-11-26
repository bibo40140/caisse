// src/renderer/services/syncClient.js
(function () {
  // Empêche l'init multiple si le script est injecté 2x (reload, double import, etc.)
  if (window.__SYNC_CLIENT_INITED__) return;
  window.__SYNC_CLIENT_INITED__ = true;

  const EL_ID = 'sync-indicator';

  function cleanupExtraChips() {
    // Supprime tout autre chip qui ne serait pas le nôtre
    const chips = document.querySelectorAll('.sync-chip');
    chips.forEach(chip => {
      if (chip.id !== EL_ID) {
        try { chip.remove(); } catch (_) {}
      }
    });
  }

  function ensureChip() {
    cleanupExtraChips();

    let el = document.getElementById(EL_ID);
    if (!el) {
      const header = document.querySelector('header') || document.body;
      el = document.createElement('div');
      el.id = EL_ID;
      el.className = 'sync-chip';
      el.textContent = '—';
      header.prepend(el);
    }
    return el;
  }

  function setChip(status, info = {}) {
    const el = ensureChip();
    el.classList.remove('is-online', 'is-offline', 'is-busy');

    switch (status) {
      case 'pushing':
        el.textContent = info.pending ? `⇧${info.pending}` : '⇧';
        el.title = `Envoi en cours${info.pending ? ` (${info.pending} op.)` : ''}`;
        el.classList.add('is-busy');
        break;
      case 'pulling':
        el.textContent = '⇣';
        el.title = 'Récupération des données';
        el.classList.add('is-busy');
        break;
      case 'online':
        const pendingCount = info.pending || 0;
        el.textContent = pendingCount > 0 ? `${pendingCount}` : '✓';
        el.title = pendingCount > 0 
          ? `En ligne — ${pendingCount} op. en attente`
          : (info.phase ? `En ligne — ${info.phase}` : 'En ligne');
        el.classList.add('is-online');
        // Ajouter un warning visuel si trop d'opérations en attente
        if (pendingCount > 50) {
          el.style.background = '#fff3cd';
          el.style.color = '#856404';
        }
        break;
      case 'offline':
        el.textContent = '✗';
        el.title = info.error ? `Hors ligne: ${info.error}` : 'Hors ligne';
        el.classList.add('is-offline');
        break;
      default:
        el.textContent = '—';
        el.title = 'État inconnu';
    }
  }

  // 🔒 Avant d’abonner, on nettoie d’éventuels anciens handlers (si ce script a déjà tourné)
  try { window.electronEvents?.off?.('sync:state'); } catch {}
  try { window.electronEvents?.off?.('ops:pushed'); } catch {}
  try { window.electronEvents?.off?.('data:refreshed'); } catch {}
  try { window.electronEvents?.off?.('data:bootstrapped'); } catch {}

  // Branche les events envoyés par le main process (via preload)
  window.electronAPI?.on?.('sync:state', (_evt, data) => setChip(data?.status, data || {}));
  window.electronAPI?.on?.('ops:pushed', (_evt, _data) => {
    setChip('pushing', { pending: 0 });
    setTimeout(() => setChip('online', { phase: 'ops_pushed' }), 600);
  });
  window.electronAPI?.on?.('data:refreshed', () => setChip('online', { phase: 'pulled' }));
  window.electronAPI?.on?.('data:bootstrapped', () => setChip('online', { phase: 'bootstrapped' }));

  // au chargement, on affiche un état neutre et on s'assure de n'avoir qu'un seul chip
  document.addEventListener('DOMContentLoaded', () => {
    cleanupExtraChips();
    setChip('online', { phase: 'ready' });
  });

  // utilitaire pour dev depuis la console
  window.syncClient = window.syncClient || {};
  window.syncClient.showState = (status) => setChip(status || 'online');
})();
