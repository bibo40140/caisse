// src/renderer/services/syncClient.js
(function () {
  const EL_ID = 'sync-indicator';

  function ensureChip() {
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
        el.textContent = '⏫ Sync…';
        el.title = `Envoi en cours${info.pending ? ` (${info.pending})` : ''}`;
        el.classList.add('is-busy');
        break;
      case 'pulling':
        el.textContent = '⏬ Sync…';
        el.title = 'Récupération des données';
        el.classList.add('is-busy');
        break;
      case 'online':
        el.textContent = '🟢 En ligne';
        el.title = info.phase ? `En ligne — ${info.phase}` : 'En ligne';
        el.classList.add('is-online');
        break;
      case 'offline':
        el.textContent = '🔴 Hors ligne';
        el.title = info.error ? `Erreur: ${info.error}` : 'Hors ligne';
        el.classList.add('is-offline');
        break;
      default:
        el.textContent = '—';
        el.title = 'État inconnu';
    }
  }

  // Branche les events envoyés par le main process
  window.electronAPI?.on?.('sync:state', (_evt, data) => setChip(data?.status, data || {}));
  window.electronAPI?.on?.('ops:pushed', (_evt, data) => {
    // rafraîchit un poil l’UI (clignotement léger)
    setChip('pushing', { pending: 0 });
    setTimeout(() => setChip('online', { phase: 'ops_pushed' }), 600);
  });
  window.electronAPI?.on?.('data:refreshed', () => setChip('online', { phase: 'pulled' }));
  window.electronAPI?.on?.('data:bootstrapped', () => setChip('online', { phase: 'bootstrapped' }));

  // au chargement, on affiche un état neutre
  document.addEventListener('DOMContentLoaded', () => setChip('online', { phase: 'ready' }));

  // utilitaire pour jouer la sync depuis la console renderer si tu veux
  window.syncClient = window.syncClient || {};
  window.syncClient.showState = (status) => setChip(status || 'online');
})();
