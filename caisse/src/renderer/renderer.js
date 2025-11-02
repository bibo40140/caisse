// src/renderer/renderer.js
(() => {
  // --- Wrappers Caisse ---
  window.renderCaisse     = (...a) => window.PageCaisse.renderCaisse(...a);
  window.validerVente     = (...a) => window.PageCaisse.validerVente(...a);

  // --- Wrappers Produits ---
  window.renderFormulaireProduit = (...a) => window.PageProduits.renderFormulaireProduit(...a);
  window.chargerProduits         = (...a) => window.PageProduits.chargerProduits(...a);

  // --- Wrappers Adhérents ---
  window.renderGestionAdherents     = (...a) => window.PageAdherents.renderGestionAdherents(...a);
  window.showFormModalAdherent      = (...a) => window.PageAdherents.showFormModalAdherent(...a);
  window.renderImportAdherents      = (...a) => window.PageAdherents.renderImportAdherents(...a);
  window.renderCotisations          = (...a) => window.PageAdherents.renderCotisations(...a);
  window.verifierCotisationAdherent = (...a) => window.PageAdherents.verifierCotisationAdherent(...a);

  // --- Wrappers Fournisseurs ---
  window.chargerFournisseurs       = (...a) => window.PageFournisseurs.chargerFournisseurs(...a);
  window.ajouterFournisseur        = (...a) => window.PageFournisseurs.ajouterFournisseur(...a);
  window.modifierFournisseur       = (...a) => window.PageFournisseurs.modifierFournisseur(...a);
  window.renderImportFournisseurs  = (...a) => window.PageFournisseurs.renderImportFournisseurs(...a);

  // --- Wrappers Réceptions ---
  window.renderReception  = (...a) => window.PageReceptions.renderReception(...a);
  window.renderReceptions = (...a) => window.PageReceptions.renderReceptions(...a);

  // --- Wrappers Inventaire ---
  window.renderInventaire = (...a) => window.PageInventaire.renderInventaire(...a);

  // --- Wrappers Paramètres ---
  window.renderParametresHome        = (...a) => window.PageParams.renderParametresHome?.(...a);
  window.renderImportExcel           = (...a) => window.PageParams.renderImportExcel(...a);
  window.importerExcel               = (...a) => window.PageParams.importerExcel(...a);
  window.renderImportProduits        = (...a) => window.PageParams.renderImportProduits(...a);
  window.renderHistoriqueFactures    = (...a) => window.PageParams.renderHistoriqueFactures?.(...a);
  window.renderGestionCategories     = (...a) => window.PageParams.renderGestionCategories(...a);
  window.renderGestionUnites         = (...a) => window.PageParams.renderGestionUnites(...a);
  window.renderGestionModesPaiement  = (...a) => window.PageParams.renderGestionModesPaiement(...a);
  window.renderActivationModules     = (...a) => window.PageParams.renderActivationModules(...a);
})();

// --- Page refresh wiring (memorize current route & expose refreshCurrentPage) ---
(function wirePageRefresh() {
  if (typeof window.navigate === 'function' && !window.__NAV_WRAPPED__) {
    const _origNavigate = window.navigate;
    window.navigate = function(page, ...args) {
      window.__CURRENT_PAGE__ = page;
      return _origNavigate.call(this, page, ...args);
    };
    window.__NAV_WRAPPED__ = true;
  }

  // Public helper to re-render current page
  window.refreshCurrentPage = function() {
    const page = window.__CURRENT_PAGE__;
    if (typeof window.navigate === 'function' && page) {
      requestAnimationFrame(() => window.navigate(page));
      return true;
    }
    // Fallbacks if needed
    if (window.PageProduits?.render) { window.PageProduits.render(); return true; }
    if (window.PageReceptions?.renderReceptions) { window.PageReceptions.renderReceptions(); return true; }
    if (window.PageReceptions?.renderReception) { window.PageReceptions.renderReception(); return true; }
    if (window.PageCaisse?.renderCaisse) { window.PageCaisse.renderCaisse(); return true; }
    return false;
  };
})();

// --- Sync chip (push/pull manuel depuis l'UI) ---
(function wireSyncChip() {
  function setChip(text, cls) {
    const chip = document.getElementById('sync-indicator');
    if (!chip) return;
    chip.textContent = text;
    chip.className = 'sync-chip ' + (cls || '');
  }


  // --- Logout button wiring ---
(function wireLogoutButton() {
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-logout');
    if (!btn) return;

    // Évite les multiples listeners si reload
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);

    fresh.addEventListener('click', async () => {
      try {
        fresh.disabled = true;
        const old = fresh.textContent;
        fresh.textContent = 'Déconnexion…';
        const res = await window.electronAPI.logout();
        if (!res || res.ok !== true) {
          throw new Error(res?.error || 'Déconnexion impossible');
        }
        // Le main fermera la fenêtre et ouvrira la page de login.
      } catch (e) {
        console.error('[logout] error:', e);
        alert('Échec de la déconnexion : ' + (e?.message || e));
        fresh.disabled = false;
        fresh.textContent = 'Se déconnecter';
      }
    });
  });
})();

// --- Tenant logo boot: fetch and display in sidebar
(() => {
  async function setTenantLogo(urlOrData) {
    const img = document.getElementById('tenant-logo');
    if (!img) return;
    if (urlOrData) {
      img.src = urlOrData;
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const r = await window.electronAPI?.getOnboardingStatus?.();
      const data = r?.data || r || {};
      // prefer a concrete url, fallback to dataUrl if that’s how you store it
      const logo = data.logo_url || data.logo || data.logo_dataUrl || '';
      await setTenantLogo(logo);
      // Expose helper so Paramètres page can refresh after upload
      window.__refreshTenantLogo__ = setTenantLogo;
    } catch { /* no logo yet */ }
  });
})();

  async function doManualSync() {
    const chip = document.getElementById('sync-indicator');
    if (!chip || chip.dataset.busy === '1') return;
    chip.dataset.busy = '1';
    setChip('⟳', 'syncing'); // état en cours

    try {
      // 1) push des ops en attente
      await window.electronAPI.opsPushNow();
      // 2) pull complet
      await window.electronAPI.syncPullAll();
      setChip('OK', 'online');

      // ✅ rafraîchir la page courante après un pull
      setTimeout(() => window.refreshCurrentPage?.(), 100);
    } catch (e) {
      console.warn('[sync chip] manual sync failed:', e?.message || e);
      setChip('OFF', 'offline');
    } finally {
      chip.dataset.busy = '0';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const chip = document.getElementById('sync-indicator');
    if (!chip) return;

    chip.title = 'Cliquer pour synchroniser (push/pull)';
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', doManualSync);

    // État initial
    setChip('OK', 'online');

    // Mises à jour poussées par le process main
    if (window.electronEvents?.on) {
      window.electronEvents.on('ops:pushed', () => setChip('⇧', 'online'));
      window.electronEvents.on('data:refreshed', () => {
        setChip('OK', 'online');
        // ✅ rafraîchir aussi quand le main nous notifie d'un pull auto
        setTimeout(() => window.refreshCurrentPage?.(), 100);
      });
    }
  });
})();
