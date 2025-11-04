// src/renderer/pages/parametres/MonCompte.js
(() => {
  // injecteur local
  const inject = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[data-dyn="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.async = false; s.dataset.dyn = src;
    s.onload = res; s.onerror = () => rej(new Error(`Fail load ${src}`));
    document.head.appendChild(s);
  });

  // petit style d’onglets si tu n’utilises pas components/tabs.js
  if (!document.getElementById('mc-tabs-style')) {
    const st = document.createElement('style');
    st.id = 'mc-tabs-style';
    st.textContent = `
      .mc-tabs { display:flex; gap:8px; border-bottom:1px solid #eee; margin:10px 0 14px; flex-wrap:wrap; }
      .mc-tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
      .mc-tab.active { background:#f3f4f6; font-weight:600; }
    `;
    document.head.appendChild(st);
  }

  async function showTab(key) {
    const host = document.getElementById('parametres-souspage');
    if (!host) return;

    // activer l’onglet
    document.querySelectorAll('.mc-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === key);
    });

    // route vers sous-modules
    try {
      if (key === 'import') {
        // utilise ta page existante imports.js déjà incluse dans index.html
        if (window.PageImports?.renderImportExcel) {
          await window.PageImports.renderImportExcel();
        } else {
          host.innerHTML = `<p>Le module d'import n'est pas chargé.</p>`;
        }
        return;
      }

      if (key === 'categories') {
        await inject('src/renderer/pages/parametres/mon-compte/categories.js');
        if (window.PageParamsCategories?.render) {
          await window.PageParamsCategories.render();
        } else {
          host.innerHTML = `<p>Module Catégories introuvable.</p>`;
        }
        return;
      }

      if (key === 'unites') {
        await inject('src/renderer/pages/parametres/mon-compte/unites.js');
        if (window.PageParamsUnites?.render) {
          await window.PageParamsUnites.render();
        } else {
          host.innerHTML = `<p>Module Unités introuvable.</p>`;
        }
        return;
      }

      if (key === 'modules') {
        await inject('src/renderer/pages/parametres/mon-compte/modules.js');
        if (window.PageParamsModules?.render) {
          await window.PageParamsModules.render();
        } else {
          host.innerHTML = `<p>Module “Activation des modules” introuvable.</p>`;
        }
        return;
      }

      if (key === 'branding') {
        await inject('src/renderer/pages/parametres/mon-compte/branding.js');
        if (window.PageParamsBranding?.render) {
          await window.PageParamsBranding.render();
        } else {
          host.innerHTML = `<p>Module Logo/Nom introuvable.</p>`;
        }
        return;
      }

      if (key === 'email') {
        await inject('src/renderer/pages/parametres/mon-compte/email.js');
        if (window.PageParamsEmail?.render) {
          await window.PageParamsEmail.render();
        } else {
          host.innerHTML = `<p>Module E-mail introuvable.</p>`;
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
      <h2>Mon compte</h2>
      <div class="mc-tabs">
        <div class="mc-tab active" data-tab="import">Import</div>
        <div class="mc-tab" data-tab="categories">Catégories</div>
        <div class="mc-tab" data-tab="unites">Unités</div>
        <div class="mc-tab" data-tab="modules">Modules</div>
        <div class="mc-tab" data-tab="branding">Logo & Nom</div>
        <div class="mc-tab" data-tab="email">E-mails</div>
      </div>
      <div id="parametres-souspage"></div>
    `;

    // bindings onglets
    content.querySelectorAll('.mc-tab').forEach(tab => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    // Onglet par défaut
    await showTab('import');
  }

  // export global
  window.PageParamsMonCompte = { render };
})();
