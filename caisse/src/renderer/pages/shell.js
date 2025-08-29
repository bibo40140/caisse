// src/renderer/pages/shell.js
(() => {
  async function applyModulesToSidebar() {
    const modules = await (window.getMods?.() || window.electronAPI.getModules());
    // Adhérents
    const liAdh = document.querySelector(
      'aside.sidebar nav li[onclick*="adherents"], aside.sidebar nav li[onclick*="adherent"]'
    );
    if (liAdh) liAdh.style.display = modules.adherents ? '' : 'none';

    // Réceptions → toujours visible, même Stocks OFF
    const liReceptions = document.querySelector('aside.sidebar nav li[onclick*="receptions"]');
    if (liReceptions) liReceptions.style.display = '';

    // Bouton Paramètres > Cotisations (si tu l’affiches dans une page)
    const btnParamCot = document.getElementById('btn-param-cotisations');
    if (btnParamCot) btnParamCot.style.display = modules.cotisations ? '' : 'none';
	
	// Inventaire visible seulement si stocks=ON
const liInv = document.querySelector('aside.sidebar nav li[onclick*="inventaire"]');
if (liInv) liInv.style.display = modules.stocks ? '' : 'none';

  }

  async function applyModulesToCaisse() {
    const modules = await (window.getMods?.() || window.electronAPI.getModules());
    const show = !!modules.adherents;
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
        window.renderFormulaireProduit();
        break;
      }
      case 'caisse': {
        title.textContent = "Caisse";
        window.renderCaisse().then(() => applyModulesToCaisse().catch(console.error));
        break;
      }
      case 'receptions': {
        title.textContent = "Réceptions";
        await window.renderReception();
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
        await window.renderGestionAdherents();
        break;
      }
      case 'fournisseurs': {
        title.textContent = "Fournisseurs";
        window.chargerFournisseurs();
        break;
      }
	  case 'inventaire': {
  title.textContent = "Inventaire";
  await window.renderInventaire();
  break;
}

      case 'parametres': {
        title.textContent = "Paramètres";
        await window.renderParametresHome(); // (déplacé dans PageParams, ci-dessous)
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
