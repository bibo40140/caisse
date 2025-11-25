// src/renderer/pages/shell.js
(() => {
  async function applyModulesToSidebar() {
    const modules = await (window.getMods?.() || window.electronAPI.getModules());

    // Adhérents
    const liAdh = document.querySelector(
      'aside.sidebar nav li[onclick*="adherents"], aside.sidebar nav li[onclick*="adherent"]'
    );
    if (liAdh) liAdh.style.display = modules?.adherents ? '' : 'none';

    // Fournisseurs
    const liFourn = document.querySelector('aside.sidebar nav li[onclick*="fournisseurs"]');
    if (liFourn) liFourn.style.display = modules?.fournisseurs ? '' : 'none';

    // Réceptions → toujours visible, même Stocks OFF
    const liReceptions = document.querySelector('aside.sidebar nav li[onclick*="receptions"]');
    if (liReceptions) liReceptions.style.display = '';

    // (Héritage) Ancien bouton Paramètres > Cotisations (inutile avec la nouvelle page, inoffensif si présent)
    const btnParamCot = document.getElementById('btn-param-cotisations');
    if (btnParamCot) btnParamCot.style.display = modules?.cotisations ? '' : 'none';

    // Inventaire visible seulement si stocks = ON
    const liInv = document.querySelector('aside.sidebar nav li[onclick*="inventaire"]');
    if (liInv) liInv.style.display = modules?.stocks ? '' : 'none';
  }

  async function applyModulesToCaisse() {
    const modules = await (window.getMods?.() || window.electronAPI.getModules());
    const show = !!modules?.adherents;
    const container = document.getElementById('adherent-container');
    const datalist  = document.getElementById('adherents-list');
    const hidden    = document.getElementById('adherent-select');
    if (container) container.style.display = show ? '' : 'none';
    if (show) {
      if (typeof window.chargerAdherents === 'function') await window.chargerAdherents();
    } else {
      if (datalist) datalist.innerHTML = '';
      if (hidden) { hidden.value = ''; hidden.dataset.email = ''; }
    }
  }

  async function navigate(page) {
    const title   = document.getElementById("page-title");
    const content = document.getElementById("page-content");

    switch (page) {
      case 'produits': {
        title.textContent = "Produits";
        window.renderFormulaireProduit?.();
        break;
      }
      case 'caisse': {
        title.textContent = "Caisse";
        if (typeof window.renderCaisse === 'function') {
          window.renderCaisse().then(() => applyModulesToCaisse().catch(console.error));
        } else {
          content.innerHTML = `<p>Module Caisse non chargé.</p>`;
        }
        break;
      }
      case 'receptions': {
        title.textContent = "Réceptions";
        if (typeof window.renderReception === 'function') {
          await window.renderReception();
        } else {
          content.innerHTML = `<p>Module Réceptions non chargé.</p>`;
        }
        break;
      }
      case 'adherents':
      case 'adherent': {
        const modules = await (window.getMods?.() || window.electronAPI.getModules());
        if (!modules?.adherents) {
          await (window.showAlertModal ? window.showAlertModal("La page Adhérents est désactivée dans les modules.") : alert("La page Adhérents est désactivée dans les modules."));
          return;
        }
        title.textContent = "Adhérents";
        if (typeof window.renderGestionAdherents === 'function') {
          await window.renderGestionAdherents();
        } else {
          content.innerHTML = `<p>Module Adhérents non chargé.</p>`;
        }
        break;
      }
      case 'fournisseurs': {
        const modules = await (window.getMods?.() || window.electronAPI.getModules());
        if (!modules?.fournisseurs) {
          await (window.showAlertModal ? window.showAlertModal("La page Fournisseurs est désactivée dans les modules.") : alert("La page Fournisseurs est désactivée dans les modules."));
          return;
        }
        title.textContent = "Fournisseurs";
        window.chargerFournisseurs?.();
        break;
      }
      case 'inventaire': {
        title.textContent = "Inventaire";
        if (typeof window.renderInventaire === 'function') {
          await window.renderInventaire();
        } else {
          content.innerHTML = `<p>Module Inventaire non chargé.</p>`;
        }
        break;
      }

      case 'parametres': {
        title.textContent = "Paramètres";
        // Lazy-load robuste de la nouvelle page Paramètres
        if (!window.PageParams?.renderHome) {
          const inject = (src) => new Promise((res, rej) => {
            if (document.querySelector(`script[data-dyn="${src}"]`)) return res();
            const s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.dataset.dyn = src;
            s.onload = res; s.onerror = () => rej(new Error(`Fail load ${src}`));
            document.head.appendChild(s);
          });

          try {
            await inject('src/renderer/utils/busy.js');
            await inject('src/renderer/utils/apiBase.js');
            await inject('src/renderer/utils/currency.js');
            await inject('src/renderer/utils/dom.js');
            await inject('src/renderer/utils/tenant.js');
            await inject('src/renderer/pages/parametres/components/tabs.js');
            await inject('src/renderer/pages/parametres/index.js');
          } catch (e) {
            console.error(e);
            const msg = (e && e.message) ? e.message : String(e);
            content.innerHTML = `<p>Impossible de charger la page Paramètres : ${msg}</p>`;
            return;
          }
        }

        if (typeof window.PageParams?.renderHome === 'function') {
          await window.PageParams.renderHome();
        } else {
          content.innerHTML = `<p>La page Paramètres est chargée mais \`renderHome()\` est introuvable.</p>`;
        }
        break;
      }

      default: {
        title.textContent = "Accueil";
        content.innerHTML = `<p>Bienvenue dans votre logiciel de caisse Coop'az !</p>`;
      }
    }
  }

  // Expose global
  window.applyModulesToSidebar = applyModulesToSidebar;
  window.applyModulesToCaisse  = applyModulesToCaisse;
  window.navigate = navigate;

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    applyModulesToSidebar().catch(console.error);
  });
})();
