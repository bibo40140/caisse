// src/renderer/pages/parametres/Synchronisation.js
(() => {
  if (!document.getElementById('sync-tabs-style')) {
    const st = document.createElement('style');
    st.id = 'sync-tabs-style';
    st.textContent = `
      .sync-tabs { display:flex; gap:8px; border-bottom:1px solid #eee; margin:10px 0 14px; flex-wrap:wrap; }
      .sync-tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
      .sync-tab.active { background:#f3f4f6; font-weight:600; }
      .sync-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); max-width:780px; }
      .muted { color:#6b7280; font-size:12px; }
    `;
    document.head.appendChild(st);
  }

  async function doPush() {
    if (!confirm("Envoyer TOUTE la base locale vers Neon (création/mise à jour) ?")) return;
    try {
      window.__syncBadgeSet?.('Envoi en cours…', '#b45309');
      const r = await (window.electronAPI?.syncPushBootstrapRefs?.() ?? window.electronAPI?.syncPushAll?.());
      if (r?.ok) {
        window.__syncBadgeSet?.('Synchronisé (push)', '#065f46');
        alert('✅ Push terminé.');
        // refresh
        try {
          window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
          const pullRes = await window.electronAPI?.syncPullAll?.();
          if (pullRes?.ok) window.__syncBadgeSet?.('Données à jour', '#065f46');
        } catch {}
      } else {
        window.__syncBadgeSet?.('Échec envoi', '#9f1239');
        alert("Push KO : " + (r?.error || 'inconnu'));
      }
    } catch (e) {
      window.__syncBadgeSet?.('Échec envoi', '#9f1239');
      alert("Push KO : " + (e?.message || e));
    }
  }

  async function doPull() {
    if (!confirm("Remplacer/mettre à jour la base LOCALE depuis Neon ?")) return;
    try {
      window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
      const r = await window.electronAPI?.syncPullAll?.();
      if (r?.ok) {
        window.__syncBadgeSet?.('Synchronisé (pull)', '#065f46');
        alert('✅ Pull terminé.');
      } else {
        window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
        alert("Pull KO : " + (r?.error || 'inconnu'));
      }
    } catch (e) {
      window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
      alert("Pull KO : " + (e?.message || e));
    }
  }

  async function render() {
    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = `
      <h2>Synchronisation</h2>
      <div class="sync-tabs">
        <div class="sync-tab active" data-tab="push">Push</div>
        <div class="sync-tab" data-tab="pull">Pull</div>
      </div>
      <div id="parametres-souspage">
        <div class="sync-card">
          <h3>Push (local → Neon)</h3>
          <p class="muted">Envoie la base locale (référentiels/produits…) vers Neon.</p>
          <button id="btn-sync-push" class="btn">Lancer le Push</button>
        </div>
      </div>
    `;

    function switchTab(key) {
      content.querySelectorAll('.sync-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
      const host = document.getElementById('parametres-souspage');
      if (key === 'push') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Push (local → Neon)</h3>
            <p class="muted">Envoie la base locale (référentiels/produits…) vers Neon.</p>
            <button id="btn-sync-push" class="btn">Lancer le Push</button>
          </div>
        `;
        host.querySelector('#btn-sync-push')?.addEventListener('click', doPush);
      } else {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Pull (Neon → local)</h3>
            <p class="muted">Remplace/met à jour la base locale depuis Neon.</p>
            <button id="btn-sync-pull" class="btn">Lancer le Pull</button>
          </div>
        `;
        host.querySelector('#btn-sync-pull')?.addEventListener('click', doPull);
      }
    }

    content.querySelectorAll('.sync-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // défaut: push
    switchTab('push');
  }

  window.PageParamsSync = { render };
})();
