// src/renderer/pages/parametres/mon-compte/branding.js
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
    __cachedTenantId = null;
    return __cachedTenantId;
  }

  async function render() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('logo-settings-style')) {
      const st = document.createElement('style');
      st.id = 'logo-settings-style';
      st.textContent = `
        .logo-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); max-width:760px; }
        .logo-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
        .logo-box { width:220px; height:90px; border:1px dashed #cbd5e1; border-radius:10px; display:flex; align-items:center; justify-content:center; background:#f8fafc; }
        .logo-box img { max-width:100%; max-height:100%; object-fit:contain; }
        .muted { color:#6b7280; font-size:12px; }
        .grow { flex:1 1 260px; }
        input[type="text"] { padding:6px 8px; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="logo-card">
        <h2 style="margin:0 0 8px 0;">Logo & nom de l’épicerie</h2>
        <div class="muted">Changement via IPC côté main (stocké côté disque + Neon).</div>
        <div class="logo-row" style="margin-top:10px;">
          <div class="logo-box">
            <img id="brand-preview" alt="Aperçu logo" style="display:none;">
            <span id="brand-empty" class="muted">Aucun logo</span>
          </div>
          <div class="grow" style="display:flex; flex-direction:column; gap:8px;">
            <label style="font-weight:600; font-size:12px;">Nom de l’épicerie</label>
            <input id="brand-name" type="text" placeholder="Nom public">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <input id="brand-file" type="file" accept="image/*">
              <button id="brand-save" class="btn">Enregistrer</button>
              <button id="brand-remove" class="btn danger">Supprimer le logo</button>
              <span id="brand-msg" class="muted"></span>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (sel) => host.querySelector(sel);
    const msg = (t, ok=true) => { const m=$('#brand-msg'); if (!m) return; m.textContent=t||''; m.style.color = ok ? '#374151' : '#b91c1c'; };

    const prev = $('#brand-preview');
    const empty = $('#brand-empty');
    const nameInput = $('#brand-name');

    let tenantId = await getCurrentTenantId();

    async function loadMeta() {
      try {
        const r = await window.electronAPI?.brandingGet?.(tenantId ? { tenantId } : undefined);
        if (!r?.ok) throw new Error(r?.error || 'Réponse invalide');

        if (typeof r.name === 'string') {
          nameInput.value = r.name;
          window.__refreshTenantName__?.(r.name);
        }

        const filePath = r.logoFile || r.file;
        if (filePath) {
          const src = `file://${String(filePath).replace(/\\/g,'/')}${r.mtime ? `?v=${Math.floor(r.mtime)}` : ''}`;
          prev.src = src;
          prev.style.display = '';
          empty.style.display = 'none';
          window.__refreshTenantLogo__?.(src);
        } else {
          prev.style.display = 'none';
          empty.style.display = '';
          window.__refreshTenantLogo__?.('');
        }
        msg('');
      } catch (e) {
        msg('Impossible de charger le branding: ' + (e?.message || e), false);
      }
    }

    await loadMeta();

    let selectedDataUrl = null;
    $('#brand-file')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) { selectedDataUrl = null; return; }
      const reader = new FileReader();
      reader.onload = () => {
        selectedDataUrl = String(reader.result);
        prev.src = selectedDataUrl;
        prev.style.display = '';
        empty.style.display = 'none';
        msg('Prévisualisation prête.');
      };
      reader.onerror = () => msg("Lecture de l'image impossible.", false);
      reader.readAsDataURL(f);
    });

    $('#brand-save')?.addEventListener('click', async () => {
      try {
        msg('Enregistrement…');
        const payload = {
          tenantId,
          name: (nameInput.value ?? '').toString(),
        };
        if (selectedDataUrl) payload.logoDataUrl = selectedDataUrl;

        const r = await window.electronAPI?.brandingSet?.(payload);
        if (!r?.ok) throw new Error(r?.error || 'Échec enregistrement');

        if (payload.name) window.__refreshTenantName__?.(payload.name);
        await loadMeta();

        const file = $('#brand-file'); if (file) file.value = '';
        selectedDataUrl = null;
        msg('Enregistré ✅');
      } catch (e) {
        msg(e?.message || String(e), false);
      }
    });

    $('#brand-remove')?.addEventListener('click', async () => {
      if (!confirm('Supprimer le logo ?')) return;
      try {
        msg('Suppression…');
        const r = await window.electronAPI?.brandingSet?.({ tenantId, deleteLogo: true });
        if (!r?.ok) throw new Error(r?.error || 'Échec suppression');
        await loadMeta();
        msg('Logo supprimé ✅');
      } catch (e) {
        msg(e?.message || String(e), false);
      }
    });
  }

  window.PageParamsBranding = { render };
})();
