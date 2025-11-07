// src/renderer/pages/parametres/index.js
(() => {
  // Helper d’injection d’un script une seule fois
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

  // Helper : injecter plusieurs scripts **dans l’ordre**
  const injectMany = async (arr) => {
    for (const src of arr) {
      // eslint-disable-next-line no-await-in-loop
      await inject(src);
    }
  };

  // Rendu de la page d’accueil Paramètres
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

    // ✅ Détection super-admin correcte (préserve le bouton si l’info n’est pas dispo)
    (async () => {
      const card = document.getElementById('card-super');
      if (!card) return;
      try {
        // Option 1 (préférée) : via preload
        const info = await window.electronAPI?.getAuthInfo?.();
        // Option 2 (fallback) : via bridge "api"
        // const info = await window.api?.invoke?.('auth:getInfo');

        if (info && (info.is_super_admin || info.role === 'super_admin')) {
          card.style.display = '';
        } else if (info) {
          card.style.display = 'none';
        } else {
          // pas d'info → on laisse visible pour éviter un faux négatif
          card.style.display = '';
        }
      } catch {
        // en cas d'erreur, ne pas masquer par défaut
        card.style.display = '';
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

    // Bind: Super tenant — charge d’abord tenants.js (définit renderTenantsAdmin), puis SuperTenant.js (renderSuperTenant)
    document.getElementById('card-super')?.addEventListener('click', async () => {
      const souspage = document.getElementById('parametres-souspage');
      try {
        await injectMany([
          'src/renderer/pages/parametres/super-tenant/tenants.js',
          'src/renderer/pages/parametres/SuperTenant.js',
        ]);
        if (window.PageParams?.renderSuperTenant) {
          window.PageParams.renderSuperTenant();
        } else {
          souspage.innerHTML = `<p>Module "Super tenant" introuvable.</p>`;
        }
      } catch (e) {
        souspage.innerHTML = `<p>Erreur de chargement : ${e?.message || e}</p>`;
      }
    });
  }

  // Export global pour shell.js
  window.PageParams = {
    ...(window.PageParams || {}),
    renderHome,
  };
})();
