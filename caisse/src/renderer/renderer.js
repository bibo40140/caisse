// src/renderer/renderer.js
(() => {
  // --- Wrappers Caisse ---
  window.renderCaisse     = (...a) => window.PageCaisse.renderCaisse?.(...a);
  window.validerVente     = (...a) => window.PageCaisse.validerVente?.(...a);

  // --- Wrappers Produits ---
  window.renderFormulaireProduit = (...a) => window.PageProduits.renderFormulaireProduit?.(...a);
  window.chargerProduits         = (...a) => window.PageProduits.chargerProduits?.(...a);

  // --- Wrappers Adhérents ---
  window.renderGestionAdherents     = (...a) => window.PageAdherents.renderGestionAdherents?.(...a);
  window.showFormModalAdherent      = (...a) => window.PageAdherents.showFormModalAdherent?.(...a);
  window.renderImportAdherents      = (...a) => window.PageAdherents.renderImportAdherents?.(...a);
  window.renderCotisations          = (...a) => window.PageAdherents.renderCotisations?.(...a);
  window.verifierCotisationAdherent = (...a) => window.PageAdherents.verifierCotisationAdherent?.(...a);

  // --- Wrappers Fournisseurs ---
  window.chargerFournisseurs       = (...a) => window.PageFournisseurs.chargerFournisseurs?.(...a);
  window.ajouterFournisseur        = (...a) => window.PageFournisseurs.ajouterFournisseur?.(...a);
  window.modifierFournisseur       = (...a) => window.PageFournisseurs.modifierFournisseur?.(...a);
  window.renderImportFournisseurs  = (...a) => window.PageFournisseurs.renderImportFournisseurs?.(...a);

  // --- Wrappers Réceptions ---
  window.renderReception  = (...a) => window.PageReceptions.renderReception?.(...a);
  window.renderReceptions = (...a) => window.PageReceptions.renderReceptions?.(...a);

  // --- Wrappers Inventaire ---
  window.renderInventaire = (...a) => window.PageInventaire.renderInventaire?.(...a);

  // --- Wrappers Paramètres (legacy; la nouvelle page utilise PageParams.renderHome via shell.js) ---
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

    // L'indicateur de sync est géré par syncClient.js
    // Écouteur pour rafraîchir l'UI quand les données sont synchronisées
    if (window.electronEvents?.on) {
      window.electronEvents.on('data:refreshed', () => {
        // Ne plus rafraîchir automatiquement pour préserver l'état de l'UI (filtres, onglets, etc.)
        // Les nouvelles données seront disponibles au prochain render naturel
        // setTimeout(() => window.refreshCurrentPage?.(), 100);
      });
      
      // Gestion des erreurs de sync limite atteinte
      window.electronEvents.on('sync:failed_limit', (data) => {
        const { count } = data || {};
        if (window.showToast) {
          window.showToast(`Échec de synchronisation : ${count} opération(s) en attente. Vérifiez la connexion.`, 'error', 8000);
        }
        console.error('[sync] Limite de retry atteinte:', count, 'opérations bloquées');
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

// --- Tenant brand (logo + nom) boot — sans fetch HTTP direct ---
(() => {
  // Hooks universels pour MAJ du titre / logo où qu'ils se trouvent
  if (typeof window.__refreshTenantName__ !== 'function') {
    window.__refreshTenantName__ = (name) => {
      const n = (name && String(name).trim()) || "CoopCaisse";
      const title =
        document.querySelector('#app-title') ||
        document.querySelector('.app-title') ||
        document.querySelector('.brand-title') ||
        document.querySelector('#tenant-name') ||
        document.querySelector('header .title');
      if (title) title.textContent = n;
      const badge = document.querySelector('[data-tenant-name]');
      if (badge) badge.textContent = n;
    };
  }
  if (typeof window.__refreshTenantLogo__ !== 'function') {
    window.__refreshTenantLogo__ = (src) => {
      const img =
        document.querySelector('#app-logo') ||
        document.querySelector('.app-logo') ||
        document.querySelector('.brand-logo') ||
        document.querySelector('#tenant-logo') ||
        document.querySelector('header .logo img');
      if (img) {
        if (src) { img.src = src; img.style.display = ''; }
        else { img.removeAttribute('src'); img.style.display = 'none'; }
      }
    };
  }

  async function ensureTenantUtilsLoaded() {
    if (window.Tenant?.applyBrandingFromStore) return;
    // inject lazy utils/tenant.js (et ses dépendances si besoin)
    const inject = (src) => new Promise((res, rej) => {
      if (document.querySelector(`script[data-dyn="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.async = false; s.dataset.dyn = src;
      s.onload = res; s.onerror = () => rej(new Error(`Fail load ${src}`));
      document.head.appendChild(s);
    });
    try {
      // Les utils peuvent déjà être chargés par shell.js, on tente uniquement tenant.js ici
      await inject('src/renderer/utils/tenant.js');
    } catch (e) {
      console.warn('[branding] tenant utils load failed (fallback IPC path still works):', e?.message || e);
    }
  }

  async function applyBrandingSafe() {
    try {
      await ensureTenantUtilsLoaded();
      if (window.Tenant?.applyBrandingFromStore) {
        // Chemin “officiel” : passe par electronAPI.brandingGet()
        await window.Tenant.applyBrandingFromStore();
        return;
      }
    } catch {}

    // Fallback minimaliste 100% IPC (sans utils/tenant.js)
    try {
      let tenantId = null;
      try {
        const info = await window.electronAPI?.getAuthInfo?.();
        tenantId =
          info?.tenant_id || info?.tenantId || info?.tid ||
          info?.id || info?.user?.tenant_id || info?.user?.tenantId || null;
    } catch {}
      const r = await window.electronAPI?.brandingGet?.(tenantId ? { tenantId } : undefined);
      if (r?.ok) {
        if (typeof r.name === 'string') window.__refreshTenantName__?.(r.name);
        if (r.logoFile || r.file) {
          const f = r.logoFile || r.file;
          const src = `file://${String(f).replace(/\\/g,'/')}${r.mtime ? `?v=${Math.floor(r.mtime)}` : ''}`;
          window.__refreshTenantLogo__?.(src);
        } else {
          window.__refreshTenantLogo__?.('');
        }
        return;
      }
    } catch (e) {
      console.warn('[branding] IPC fallback error:', e?.message || e);
    }
  }

  // Re-applique quand le main diffuse des changements de config
  if (window.electronEvents?.on) {
    window.electronEvents.on('config:changed', (_e, cfg) => {
      const name = cfg?.store_name || cfg?.tenant_name || cfg?.company_name || cfg?.name;
      if (name) window.__refreshTenantName__?.(name);
    });
  }

  document.addEventListener('DOMContentLoaded', applyBrandingSafe);
})();
