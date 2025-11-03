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
  window.renderImportExcel           = (...a) => window.PageParams.renderImportExcel?.(...a);
  window.importerExcel               = (...a) => window.PageParams.importerExcel?.(...a);
  window.renderImportProduits        = (...a) => window.PageParams.renderImportProduits?.(...a);
  window.renderHistoriqueFactures    = (...a) => window.PageParams.renderHistoriqueFactures?.(...a);
  window.renderGestionCategories     = (...a) => window.PageParams.renderGestionCategories?.(...a);
  window.renderGestionUnites         = (...a) => window.PageParams.renderGestionUnites?.(...a);
  window.renderGestionModesPaiement  = (...a) => window.PageParams.renderGestionModesPaiement?.(...a);
  window.renderActivationModules     = (...a) => window.PageParams.renderActivationModules?.(...a);
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

  async function doManualSync() {
    const chip = document.getElementById('sync-indicator');
    if (!chip || chip.dataset.busy === '1') return;
    chip.dataset.busy = '1';
    setChip('⟳', 'syncing'); // état en cours

    try {
      // 1) push des ops en attente
      await window.electronAPI?.opsPushNow?.();
      // 2) pull complet
      await window.electronAPI?.syncPullAll?.();
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
        const res = await window.electronAPI?.logout?.();
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

// --- Tenant brand (logo + nom) boot --- *** MODIFIÉ POUR TENANT ***
(() => {
  let __cachedTenantId = null;
  async function getCurrentTenantId() {
    if (__cachedTenantId) return __cachedTenantId;
    try {
      const info = await window.electronAPI?.getAuthInfo?.();
      const tid =
        info?.tenant_id || info?.tenantId || info?.tid ||
        info?.id || info?.user?.tenant_id || info?.user?.tenantId;
      if (tid) { __cachedTenantId = String(tid); return __cachedTenantId; }
    } catch {}
    try {
      const ob = await window.electronAPI?.getOnboardingStatus?.();
      const data = ob?.data || ob || {};
      const tid = data?.tenant_id || data?.tenantId || data?.id;
      if (tid) { __cachedTenantId = String(tid); return __cachedTenantId; }
    } catch {}
    __cachedTenantId = 'default';
    return __cachedTenantId;
  }

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

  function setTenantName(name) {
    const el = document.getElementById('tenant-name');
    if (!el) return;
    el.textContent = (name && String(name).trim()) || "Coop'az";
  }

  async function loadBranding() {
  // base API
  async function getApiBaseFromConfig() {
    try {
      const cfg = await (window.electronAPI?.getConfig?.() || {});
      return (cfg && cfg.api_base_url) ? cfg.api_base_url.replace(/\/+$/, '') : '';
    } catch { return ''; }
  }
  const apiBase = await getApiBaseFromConfig();

  if (apiBase) {
    try {
      const r = await fetch(`${apiBase}/branding`, {
        credentials: 'include',
        headers: (localStorage.getItem('auth_token')
          ? { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
          : {})
      });
      if (r.ok) {
        const js = await r.json();
        if (js?.ok) {
          if (js.name) setTenantName(js.name);
          if (js.has_logo) {
            const url = `${apiBase}/branding/logo?ts=${Date.now()}`;
            await setTenantLogo(url);
          }
          return; // on a réussi → on sort
        }
      }
    } catch {}
  }

  // Fallbacks (onboarding / auth info) au cas où
  try {
    const r = await window.electronAPI?.getOnboardingStatus?.();
    const data = r?.data || r || {};
    const name = data.store_name || data.tenant_name || data.company_name || data.name;
    if (name) setTenantName(name);
  } catch {}
  try {
    const info = await window.electronAPI?.getAuthInfo?.();
    const name =
      info?.store_name || info?.tenant_name || info?.company_name || info?.company || info?.name;
    if (name) setTenantName(name);
  } catch {}
}


  // Permettre une mise à jour “live” quand la page Logo enregistre
  window.__refreshTenantLogo__ = async (urlOrData) => {
    const tenantId = await getCurrentTenantId();
    if (urlOrData) {
      await setTenantLogo(urlOrData);
    } else {
      // recharger depuis branding:get (par tenant)
      try {
        const r = await window.electronAPI?.brandingGet?.({ tenantId });
        if (r?.ok && (r.file || r.logoFile)) {
          const lf = r.file || r.logoFile;
          const src = `file://${String(lf).replace(/\\/g, '/')}${r.mtime ? `?v=${Math.floor(r.mtime)}` : ''}`;
          await setTenantLogo(src);
        } else {
          await setTenantLogo(null);
        }
      } catch {
        await setTenantLogo(null);
      }
    }
  };

  // Mettre à jour automatiquement si le main broadcast la config
  if (window.electronEvents?.on) {
    window.electronEvents.on('config:changed', (_e, cfg) => {
      const name = cfg?.store_name || cfg?.tenant_name || cfg?.company_name || cfg?.name;
      if (name) setTenantName(name);
    });
  }

  document.addEventListener('DOMContentLoaded', loadBranding);
})();
