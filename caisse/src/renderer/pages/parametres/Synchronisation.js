// src/renderer/pages/parametres/Synchronisation.js
(() => {
  // ——————————————————————————————————————————————
  //  Style minimal pour l’onglet de synchronisation
  //  (on NE touche PAS à .btn globale de l’app)
  // ——————————————————————————————————————————————
  if (!document.getElementById('sync-tabs-style')) {
    const st = document.createElement('style');
    st.id = 'sync-tabs-style';
    st.textContent = `
      .sync-tabs {
        display:flex;
        gap:8px;
        border-bottom:1px solid #eee;
        margin:10px 0 14px;
        flex-wrap:wrap;
      }
      .sync-tab {
        padding:8px 12px;
        border-radius:8px 8px 0 0;
        cursor:pointer;
      }
      .sync-tab.active {
        background:#f3f4f6;
        font-weight:600;
      }
      .sync-card {
        background:#fff;
        border:1px solid #e5e7eb;
        border-radius:12px;
        padding:14px;
        box-shadow:0 4px 14px rgba(0,0,0,.05);
        max-width:780px;
      }
      .muted {
        color:#6b7280;
        font-size:12px;
      }
      .sync-status {
        border:1px solid #eee;
        padding:12px;
        border-radius:8px;
        margin:10px 0;
      }
      .sync-actions {
        display:flex;
        gap:10px;
        margin-top:8px;
        flex-wrap:wrap;
      }
    `;
    document.head.appendChild(st);
  }

  // ——————————————————————————————————————————————
  //  Panneau d’état (file d’attente d’ops)
  // ——————————————————————————————————————————————
  async function showSyncPanel(hostId = 'parametres-souspage') {
    try {
      const s = await window.electronAPI.opsPendingCount?.();
      const pending = (s && typeof s.count === 'number') ? s.count : (s?.queue ?? 0);

      const old = document.getElementById('__sync-panel');
      if (old) old.remove();

      const wrap = document.getElementById(hostId) || document.body;
      const box = document.createElement('div');
      box.id = '__sync-panel';
      box.className = 'sync-status';
      box.innerHTML = `
        <h3>🛰️ État de la synchro</h3>
        <div>En file d’attente : <strong>${pending}</strong></div>
        <div class="sync-actions">
          <button id="sync-now" class="btn">🔄 Pousser maintenant</button>
        </div>
        <pre id="sync-debug-pre" style="margin-top:8px; max-height:220px; overflow:auto; font-size:11px; background:#f9fafb; padding:8px; border-radius:6px;"></pre>
      `;
      wrap.appendChild(box);

      // petit debug : on affiche ce que renvoie opsPendingCount
      const pre = box.querySelector('#sync-debug-pre');
      if (pre) {
        pre.textContent = JSON.stringify(s, null, 2);
      }

      box.querySelector('#sync-now').onclick = async () => {
        try {
          const r = await window.electronAPI.opsPushNow();
          if (!r || r.ok === false) {
            alert('Échec du push des opérations : ' + (r?.error || 'inconnu'));
          } else {
            const msg = `✅ Ops poussées.\nEnvoyées: ${r.sent ?? '??'}\nReste en file: ${r.pending ?? '??'}`;
            alert(msg);
          }
        } catch (e) {
          alert('Erreur lors du push des opérations : ' + (e?.message || e));
        }
        // on rafraîchit le panneau
        showSyncPanel(hostId);
      };
    } catch (e) {
      console.error('[Synchronisation] showSyncPanel error:', e);
    }
  }

  // ——————————————————————————————————————————————
  //  Actions PUSH / PULL (boutons)
  // ——————————————————————————————————————————————
  async function doPush() {
    if (!confirm("Envoyer TOUTE la base locale vers Neon (création/mise à jour complète) ?")) return;
    try {
      window.__syncBadgeSet?.('Envoi complet…', '#b45309');
      const r = await (window.electronAPI?.syncPushBootstrapRefs?.() ?? window.electronAPI?.syncPushAll?.());
      if (r?.ok) {
        window.__syncBadgeSet?.('Synchronisé (push complet)', '#065f46');
        alert('✅ Push complet terminé.');
        try {
          window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
          const pullRes = await window.electronAPI?.syncPullAll?.();
          if (pullRes?.ok) window.__syncBadgeSet?.('Données à jour', '#065f46');
        } catch {}
      } else {
        window.__syncBadgeSet?.('Échec envoi complet', '#9f1239');
        alert("Push complet KO : " + (r?.error || 'inconnu'));
      }
    } catch (e) {
      window.__syncBadgeSet?.('Échec envoi complet', '#9f1239');
      alert("Push complet KO : " + (e?.message || e));
    }
  }

  async function doPull() {
    if (!confirm("Remplacer/mettre à jour la base LOCALE depuis Neon (pull complet) ?")) return;
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

  // ——————————————————————————————————————————————
  //  Rendu de la page Paramètres > Synchronisation
  // ——————————————————————————————————————————————
  async function render() {
    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = `
      <h2>Synchronisation</h2>

      <div class="sync-tabs">
        <div class="sync-tab active" data-tab="push">Push</div>
        <div class="sync-tab" data-tab="pull">Pull</div>
      </div>

      <div id="parametres-souspage"><!-- contenu tab injecté ici --></div>
   `;

    function switchTab(key) {
      content.querySelectorAll('.sync-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
      const host = document.getElementById('parametres-souspage');

      if (key === 'push') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Push (local → Neon)</h3>
            <p class="muted">
              Envoie la base locale (référentiels / produits…) vers Neon.
              À utiliser pour un gros rattrapage ou une première mise en ligne.
            </p>
            <div class="sync-actions">
              <button id="btn-sync-push" class="btn">Lancer le Push complet</button>
            </div>
          </div>
        `;
        host.querySelector('#btn-sync-push')?.addEventListener('click', doPush);
      } else {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Pull (Neon → local)</h3>
            <p class="muted">
              Remplace / met à jour la base locale depuis Neon.
            </p>
            <div class="sync-actions">
              <button id="btn-sync-pull" class="btn">Lancer le Pull complet</button>
            </div>
          </div>
        `;
        host.querySelector('#btn-sync-pull')?.addEventListener('click', doPull);
      }

      // panneau d'état (file d'attente + bouton "Pousser maintenant")
      showSyncPanel('parametres-souspage');
    }

    content.querySelectorAll('.sync-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // onglet par défaut : Push
    switchTab('push');
  }

  window.PageParamsSync = { render };
})();
