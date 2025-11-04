(() => {
  let __cachedTenantId = null;

  async function getCurrentTenantId() {
    if (__cachedTenantId) return __cachedTenantId;
    try {
      if (typeof window.electronAPI?.getAuthInfo === 'function') {
        const info = await window.electronAPI.getAuthInfo();
        const tid =
          info?.tenant_id || info?.tenantId || info?.tid ||
          info?.id || info?.user?.tenant_id || info?.user?.tenantId;
        if (tid) { __cachedTenantId = String(tid); return __cachedTenantId; }
      }
    } catch {}
    try {
      const ob = await window.electronAPI?.getOnboardingStatus?.();
      const data = ob?.data || ob || {};
      const tid = data?.tenant_id || data?.tenantId || data?.id;
      if (tid) { __cachedTenantId = String(tid); return __cachedTenantId; }
    } catch {}
    try {
      const tok = window.ApiClient?.getToken?.() || localStorage.getItem('auth_token') || localStorage.getItem('mt_token') || localStorage.getItem('jwt');
      if (tok) {
        const payload = (() => {
          try {
            const p = tok.split('.')[1];
            const base64 = p.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '==='.slice((base64.length + 3) % 4);
            const json = atob(padded);
            return JSON.parse(decodeURIComponent(Array.from(json).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join('')));
          } catch { return null; }
        })();
        const tid = payload?.tenant_id || payload?.tenantId;
        if (tid) { __cachedTenantId = String(tid); return __cachedTenantId; }
      }
    } catch {}
    __cachedTenantId = null;
    return __cachedTenantId;
  }

  // Branding hooks for header (name & logo)
  if (typeof window.__refreshTenantName__ !== 'function') {
    window.__refreshTenantName__ = (name) => {
      const title =
        document.querySelector('#app-title') ||
        document.querySelector('.app-title') ||
        document.querySelector('.brand-title') ||
        document.querySelector('header .title');
      if (title) title.textContent = String(name || '').trim();
      const badge = document.querySelector('[data-tenant-name]');
      if (badge) badge.textContent = String(name || '').trim();
    };
  }
  if (typeof window.__refreshTenantLogo__ !== 'function') {
    window.__refreshTenantLogo__ = (src) => {
      const img =
        document.querySelector('#app-logo') ||
        document.querySelector('.app-logo') ||
        document.querySelector('.brand-logo') ||
        document.querySelector('header .logo img');
      if (img) {
        if (src) { img.src = src; img.style.display = ''; }
        else { img.removeAttribute('src'); img.style.display = 'none'; }
      }
    };
  }

  async function applyBrandingFromStore() {
    try {
      const tenantId = await getCurrentTenantId();
      const args = tenantId ? { tenantId } : undefined;
      const r = await window.electronAPI?.brandingGet?.(args);
      if (!r?.ok) return;
      if (typeof r.name === 'string') window.__refreshTenantName__?.(r.name);
      if (r.logoFile || r.file) {
        const f = r.logoFile || r.file;
        const src = `file://${String(f).replace(/\\/g,'/')}${r.mtime ? `?v=${Math.floor(r.mtime)}` : ''}`;
        window.__refreshTenantLogo__?.(src);
      } else {
        window.__refreshTenantLogo__?.('');
      }
    } catch {}
  }

  window.Tenant = { getCurrentTenantId, applyBrandingFromStore };
})();