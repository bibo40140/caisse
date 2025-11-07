// src/renderer/pages/parametres/Historique.js
(() => {
  const inject = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[data-dyn="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.async = false; s.dataset.dyn = src;
    s.onload = res; s.onerror = () => rej(new Error(`Fail load ${src}`));
    document.head.appendChild(s);
  });

  if (!document.getElementById('hist-tabs-style')) {
    const st = document.createElement('style');
    st.id = 'hist-tabs-style';
    st.textContent = `
      .hist-tabs { display:flex; gap:8px; border-bottom:1px solid #eee; margin:10px 0 14px; flex-wrap:wrap; }
      .hist-tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
      .hist-tab.active { background:#f3f4f6; font-weight:600; }
    `;
    document.head.appendChild(st);
  }

  async function showTab(key) {
    const host = document.getElementById('parametres-souspage');
    if (!host) return;

    document.querySelectorAll('.hist-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === key);
    });

    try {
      if (key === 'ventes') {
        await inject('src/renderer/pages/parametres/historique/ventes.js');
        if (window.PageParamsHistoriqueVentes?.render) {
          await window.PageParamsHistoriqueVentes.render();
        } else if (window.PageParams?.renderHistoriqueFactures) {
          await window.PageParams.renderHistoriqueFactures();
        } else if (window.renderHistoriqueFactures) {
          await window.renderHistoriqueFactures();
        } else {
          host.innerHTML = `<p>Module Historique des ventes introuvable.</p>`;
        }
        return;
      }

      if (key === 'receptions') {
        if (window.PageReceptions?.renderReceptions) {
          await window.PageReceptions.renderReceptions();
        } else if (window.renderReceptions) {
          await window.renderReceptions();
        } else {
          host.innerHTML = `<p>Module Historique des réceptions introuvable.</p>`;
        }
        return;
      }

      if (key === 'inventaires') {
        await inject('src/renderer/pages/parametres/historique/inventaires.js');
        if (window.PageParamsHistoriqueInventaires?.render) {
          await window.PageParamsHistoriqueInventaires.render();
        } else if (window.PageParams?.renderHistoriqueInventaires) {
          await window.PageParams.renderHistoriqueInventaires();
        } else {
          host.innerHTML = `<p>Module Historique des inventaires introuvable.</p>`;
        }
        return;
      }

      if (key === 'cotisations') {
        await inject('src/renderer/pages/parametres/historique/cotisations.js');
        if (window.PageParamsHistoriqueCotisations?.render) {
          await window.PageParamsHistoriqueCotisations.render();
        } else {
          host.innerHTML = `<p>Module Historique des cotisations introuvable.</p>`;
        }
        return;
      }

      host.innerHTML = `<p>Onglet inconnu.</p>`;
    } catch (e) {
      console.error(e);
      host.innerHTML = `<p>Erreur lors du chargement : ${e?.message || e}</p>`;
    }
  }

  async function render() {
    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = `
      <h2>Historique</h2>
      <div class="hist-tabs">
        <div class="hist-tab active" data-tab="ventes">Ventes</div>
        <div class="hist-tab" data-tab="receptions">Réceptions</div>
        <div class="hist-tab" data-tab="inventaires">Inventaires</div>
        <div class="hist-tab" data-tab="cotisations">Cotisations</div>
      </div>
      <div id="parametres-souspage"></div>
    `;

    content.querySelectorAll('.hist-tab').forEach(tab => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    // défaut : ventes
    await showTab('ventes');
  }

  window.PageParamsHistorique = { render };
})();
