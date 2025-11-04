// src/renderer/pages/parametres/index.js
(() => {
  // Petit helper d’injection (utilise dom.js si présent, sinon fallback local)
  const inject = (src) =>
    new Promise((res, rej) => {
      if (document.querySelector(`script[data-dyn="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.dyn = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`Fail load ${src}`));
      document.head.appendChild(s);
    });

  // Rendu de la page d’accueil Paramètres (4 familles)
  async function renderHome() {
    const content = document.getElementById('page-content');
    if (!content) return;

    // Style minimal des cartes
    if (!document.getElementById('params-cards-style')) {
      const st = document.createElement('style');
      st.id = 'params-cards-style';
      st.textContent = `
        .params-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px,1fr)); gap:14px; }
        .params-card { border:1px solid #e5e7eb; border-radius:12px; background:#fff; padding:14px;
                       box-shadow:0 4px 14px rgba(0,0,0,.05); cursor:pointer; display:flex; gap:10px; align-items:flex-start; }
        .params-card:hover { box-shadow:0 8px 22px rgba(0,0,0,.08); }
        .params-card h3 { margin:0 0 6px 0; font-size:16px; }
        .params-card p { margin:0; color:#6b7280; font-size:13px; }
        .params-ico { font-size:22px; line-height:1; }
      `;
      document.head.appendChild(st);
    }

    content.innerHTML = `
      <h2>Paramètres</h2>
      <div class="params-grid">
        <div class="params-card" id="card-moncompte">
          <div class="params-ico">👤</div>
          <div>
            <h3>Mon compte</h3>
            <p>Import, catégories, unités, modules, logo, e-mails…</p>
          </div>
        </div>
        <div class="params-card" id="card-sync">
          <div class="params-ico">🔄</div>
          <div>
            <h3>Synchronisation</h3>
            <p>Push & Pull avec Neon.</p>
          </div>
        </div>
        <div class="params-card" id="card-histo">
          <div class="params-ico">📚</div>
          <div>
            <h3>Historique</h3>
            <p>Ventes, réceptions, inventaires.</p>
          </div>
        </div>
        <div class="params-card" id="card-super">
          <div class="params-ico">🛡️</div>
          <div>
            <h3>Super tenant</h3>
            <p>Gestion des tenants (super admin).</p>
          </div>
        </div>
      </div>
      <div id="parametres-souspage" style="margin-top:14px;"></div>
    `;

    // Détection super-admin pour afficher/masquer la carte Super tenant
    (async () => {
      try {
        const info = await window.electronAPI?.getAuthInfo?.();
        const isSuper = !!info?.is_super_admin || info?.role === 'super_admin' || info === true;
        const card = document.getElementById('card-super');
        if (card) card.style.display = isSuper ? '' : 'none';
      } catch {
        // si erreur : ne rien masquer (ou masquer si tu préfères)
      }
    })();

    // Bind: Mon compte
    document.getElementById('card-moncompte')?.addEventListener('click', async () => {
      await inject('src/renderer/pages/parametres/MonCompte.js');
      if (window.PageParamsMonCompte?.render) {
        await window.PageParamsMonCompte.render();
      } else {
        document.getElementById('parametres-souspage').innerHTML = `<p>Module "Mon compte" introuvable.</p>`;
      }
    });

    // Bind: Synchronisation
    document.getElementById('card-sync')?.addEventListener('click', async () => {
      await inject('src/renderer/pages/parametres/Synchronisation.js');
      if (window.PageParamsSync?.render) {
        await window.PageParamsSync.render();
      } else {
        document.getElementById('parametres-souspage').innerHTML = `<p>Module "Synchronisation" introuvable.</p>`;
      }
    });

    // Bind: Historique
    document.getElementById('card-histo')?.addEventListener('click', async () => {
      await inject('src/renderer/pages/parametres/Historique.js');
      if (window.PageParamsHistorique?.render) {
        await window.PageParamsHistorique.render();
      } else {
        document.getElementById('parametres-souspage').innerHTML = `<p>Module "Historique" introuvable.</p>`;
      }
    });

    // Bind: Super tenant
    document.getElementById('card-super')?.addEventListener('click', async () => {
      await inject('src/renderer/pages/parametres/SuperTenant.js');
      if (window.PageParamsSuperTenant?.render) {
        await window.PageParamsSuperTenant.render();
      } else {
        document.getElementById('parametres-souspage').innerHTML = `<p>Module "Super tenant" introuvable.</p>`;
      }
    });
  }

  // Export global pour shell.js
  window.PageParams = {
    renderHome,
  };
})();
