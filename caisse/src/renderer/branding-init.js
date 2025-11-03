(() => {
  // Ces 2 helpers sont déjà définis dans parametres.js, on met un fallback au cas où.
  if (typeof window.__refreshTenantName__ !== 'function') {
  window.__refreshTenantName__ = (name) => {
    const txt = String(name || '').trim();

    // 🔹 Ajoute ton sélecteur réel
    const targets = [
      '#tenant-name',         // ✅ ton h2 dans la sidebar
      '#app-title',
      '.app-title',
      '.brand-title',
      'header .title',
      '[data-tenant-name]'
    ];

    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) el.textContent = txt;
    }
  };
}
if (typeof window.__refreshTenantLogo__ !== 'function') {
  window.__refreshTenantLogo__ = (src) => {
    const targets = [
      '#tenant-logo',         // ✅ ton <img> logo dans la sidebar
      '#app-logo',
      '.app-logo',
      '.brand-logo',
      'header .logo img'
    ];
    for (const sel of targets) {
      const img = document.querySelector(sel);
      if (!img) continue;
      if (src) { img.src = src; img.style.display = ''; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }
    }
  };
}  async function applyBrandingFromStore() {
    try {
      // Laisse le main déduire le tenant via JWT si on ne fournit pas tenantId
      const r = await window.electronAPI?.brandingGet?.();
      if (!r?.ok) return;
      if (typeof r.name === 'string') {
        window.__refreshTenantName__?.(r.name);
      }
      if (r.logoFile || r.file) {
        const f = r.logoFile || r.file;
        const src = `file://${String(f).replace(/\\/g,'/')}${r.mtime ? `?v=${Math.floor(r.mtime)}` : ''}`;
        window.__refreshTenantLogo__?.(src);
      } else {
        window.__refreshTenantLogo__?.('');
      }
    } catch (e) {
      // silencieux
    }
  }

  // Au chargement de chaque page
  document.addEventListener('DOMContentLoaded', applyBrandingFromStore);
  // A chaque changement de config (si le main en émet à la création des fenêtres)
  if (window.electronEvents?.on) {
    window.electronEvents.on('config:changed', () => applyBrandingFromStore());
  }

  // Expose au besoin pour réutilisation
  window.applyBrandingFromStore = applyBrandingFromStore;
})();
