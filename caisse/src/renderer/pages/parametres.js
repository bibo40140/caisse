// src/renderer/pages/parametres.js
(() => {
  // ----------------------------
  // Helpers UI
  // ----------------------------
  function showBusy(message = 'Veuillez patienter…') {
    let overlay = document.getElementById('busy-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'busy-overlay';
      overlay.innerHTML = `
        <div class="busy-backdrop"></div>
        <div class="busy-modal">
          <div class="busy-spinner"></div>
          <div class="busy-text"></div>
        </div>`;
      document.body.appendChild(overlay);

      const style = document.createElement('style');
      style.id = 'busy-style';
      style.textContent = `
        #busy-overlay { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
        .busy-backdrop { position:absolute; inset:0; background: rgba(0,0,0,.35); backdrop-filter: blur(2px); }
        .busy-modal { position:relative; background:#fff; border-radius:12px; padding:20px 28px; min-width: 280px; display:flex; gap:12px; align-items:center; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
        .busy-spinner { width: 26px; height: 26px; border: 3px solid #ddd; border-top-color: #4a89dc; border-radius: 50%; animation: spin .9s linear infinite; }
        .busy-text { font-size: 14px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }
    overlay.querySelector('.busy-text').textContent = message;
    overlay.style.display = 'grid';
  }
  function hideBusy() {
    const overlay = document.getElementById('busy-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  function showAlertModal(msg) { alert(msg); }

  // ----------------------------
  // Tenant helpers (ID courant)
  // ----------------------------
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

  // ----------------------------
  // Hooks de fallback pour le header (nom & logo)
  // ----------------------------
  (function ensureBrandingHooks(){
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
  })();

  // Applique le branding stocké (appelable au démarrage et depuis les pages)
async function applyBrandingFromStore() {
  try {
    const tenantId = await getCurrentTenantId();
    const r = await window.electronAPI?.brandingGet?.({ tenantId });
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
  } catch {}
}

  // ----------------------------
  // Modules (tenant)
  // ----------------------------
  async function getActiveModules() {
    try {
      if (window.electronAPI?.getTenantModules) {
        const r = await window.electronAPI.getTenantModules();
        if (r?.ok && r.modules) return r.modules;
      }
    } catch {}
    try {
      if (typeof window.getMods === 'function') return await window.getMods();
      if (window.electronAPI?.getModules) return await window.electronAPI.getModules();
    } catch {}
    return {};
  }
  async function saveActiveModules(modules) {
    if (window.electronAPI?.setTenantModules) {
      const r = await window.electronAPI.setTenantModules(modules);
      if (!r?.ok) throw new Error(r?.error || 'setTenantModules KO');
    }
    if (window.electronAPI?.setModules) { try { await window.electronAPI.setModules(modules); } catch {} }
  }

  // ----------------------------
  // Accueil Paramètres (sans identité)
  // ----------------------------
  function renderParametresHome() {
    // Styles de layout uniquement (pas de styles de boutons ici)
    if (!document.getElementById('params-menu-style')) {
      const st = document.createElement('style');
      st.id = 'params-menu-style';
      st.textContent = `
        /* Le conteneur prend toute la largeur */
        #page-content .params-actions { display:block !important; width:100% !important; }

        /* Grille responsive SANS TROUS, et imposée avec !important */
        #page-content ul.params-menu {
          display: grid !important;
          width: 100% !important;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)) !important;
          gap: 12px !important;
          grid-auto-flow: row dense !important;
          list-style: none !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        /* Un <li> masqué ne réserve aucune place */
        #page-content ul.params-menu > li[hidden] { display: none !important; }

        /* Les boutons s'étirent dans leur cellule */
        #page-content ul.params-menu > li > .btn {
          display: inline-flex !important;
          width: 100% !important;
          justify-content: center !important;
        }
      `;
      document.head.appendChild(st);
    }

    const content = document.getElementById('page-content');
    content.innerHTML = `
      <h2>Paramètres</h2>

      <!-- ⚠️ Identité retirée : on gère le logo dans "Logo" -->
      <div class="params-actions">
        <ul class="params-menu">
          <li><button id="btn-param-import" class="btn">📂 Import données</button></li>
          <li><button id="btn-param-historique" class="btn">Historique des ventes</button></li>
          <li><button id="btn-param-cotisations" class="btn">Cotisations</button></li>
          <li><button id="btn-param-historiquerecetpion" class="btn">Historique réception</button></li>
          <li><button id="btn-param-inv-histo" class="btn">Historique des inventaires</button></li>
          <li><button id="btn-param-categories" class="btn">Gérer les catégories</button></li>
          <li><button id="btn-param-unites" class="btn">Unités</button></li>
          <li><button id="btn-param-modes" class="btn">Modes de paiement</button></li>
          <li><button id="btn-param-modules" class="btn">Modules</button></li>
          <li><button id="btn-param-prospects" class="btn">Prospects</button></li>
          <li><button id="btn-sync-push" class="btn">Push produits (local → Neon)</button></li>
          <li><button id="btn-sync-pull" class="btn">Pull produits (Neon → local)</button></li>
          <li><button id="btn-tenants-admin" class="btn" style="display:none;">Tenants (Super admin)</button></li>
          <li><button id="btn-param-email" class="btn">Email d’envoi</button></li>
          <li><button id="btn-param-logo" class="btn">Logo</button></li>
          <li><button id="btn-param-autres" class="btn">Autres paramètres</button></li>
        </ul>
      </div>

      <div id="parametres-souspage"></div>
    `;

    // ➜ applique le branding au header quand on arrive ici
    applyBrandingFromStore();

    // --- Super admin detection (affiche le bouton Tenants)
    function decodeJwtPayload(tok) {
      try {
        const p = tok.split('.')[1];
        const base64 = p.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '==='.slice((base64.length + 3) % 4);
        const json = atob(padded);
        return JSON.parse(decodeURIComponent(Array.from(json).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join('')));
      } catch { return null; }
    }
    function showTenantButtonIfSuper(info) {
      const btnTen = document.getElementById('btn-tenants-admin');
      if (!btnTen) return;
      const isSuper = !!info?.is_super_admin || info?.role === 'super_admin' || info === true;
      btnTen.style.display = isSuper ? '' : 'none';
      if (isSuper && !btnTen.__bound) { btnTen.addEventListener('click', renderTenantsAdmin); btnTen.__bound = true; }
    }
    (async function detectSuperAdmin() {
      try {
        if (window.electronAPI?.getAuthInfo) {
          const info = await window.electronAPI.getAuthInfo();
          if (info) { showTenantButtonIfSuper(info); return; }
        }
      } catch {}
      try {
        const tok = window.ApiClient?.getToken?.() || localStorage.getItem('auth_token') || localStorage.getItem('mt_token') || localStorage.getItem('jwt');
        if (tok) { const payload = decodeJwtPayload(tok); showTenantButtonIfSuper(payload); }
      } catch {}
    })();

    // Voyant réseau/sync (layout only)
    (function ensureSyncStatusBadge(){
      let el = document.getElementById('sync-status');
      if (!el) {
        el = document.createElement('div');
        el.id = 'sync-status';
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.right = '12px';
        el.style.zIndex = '9999';
        el.style.userSelect = 'none';
        document.body.appendChild(el);
      }
      function setStatus(text, color){
        el.textContent = text;
        el.style.background = color;
        el.style.color = '#fff';
        el.style.padding = '6px 10px';
        el.style.borderRadius = '999px';
        el.style.fontSize = '12px';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        el.style.display = 'inline-block';
      }
      const online  = () => setStatus('En ligne', '#065f46');
      const offline = () => setStatus('Hors ligne', '#b91c1c');
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      if (navigator.onLine) online(); else offline();
      if (window.electronEvents?.on) {
        window.electronEvents.on('ops:pushed', (_e, p) => setStatus(`Envoyé: ${p?.count || 0}`, '#065f46'));
        window.electronEvents.on('data:refreshed', () => setStatus('Données à jour', '#065f46'));
      }
      window.__syncBadgeSet = setStatus;
    })();

    // Connexion API (chargement silencieux)
    (async function setupMtAuthUI(){
      try { await loadScriptOnce('src/renderer/lib/apiClient.js'); } catch {}
    })();

    // Boutons → sous-pages
    document.getElementById('btn-param-import')         ?.addEventListener('click', () => window.PageImports?.renderImportExcel?.());
    document.getElementById('btn-param-historique')     ?.addEventListener('click', () => window.PageParams.renderHistoriqueFactures());
    document.getElementById('btn-param-cotisations')    ?.addEventListener('click', () => window.renderCotisations?.());
    document.getElementById('btn-param-historiquerecetpion')?.addEventListener('click', () => window.PageReceptions?.renderReceptions?.());
    document.getElementById('btn-param-inv-histo')      ?.addEventListener('click', () => renderHistoriqueInventaires());
    document.getElementById('btn-param-categories')     ?.addEventListener('click', () => renderGestionCategories());
    document.getElementById('btn-param-unites')         ?.addEventListener('click', () => renderGestionUnites());
    document.getElementById('btn-param-modes')          ?.addEventListener('click', () => renderGestionModesPaiement());
    document.getElementById('btn-param-modules')        ?.addEventListener('click', () => renderActivationModules());
    document.getElementById('btn-param-autres')         ?.addEventListener('click', () => window.renderGestionParametres?.());
    document.getElementById('btn-param-email')          ?.addEventListener('click', () => renderEmailSettings());
    document.getElementById('btn-param-logo')
      ?.addEventListener('click', () => window.PageParams.renderTenantBrandingSettings());

    document.getElementById('btn-param-prospects')?.addEventListener('click', async () => {
      try {
        const mods = await getActiveModules();
        if (!mods?.prospects) { alert("Le module Prospects n'est pas activé (Paramètres > Modules)."); return; }
        if (!window.PageProspects?.render) { await loadScriptOnce('src/renderer/pages/prospects.js'); }
        const fn = window.PageProspects?.render || window.renderProspectsPage;
        if (typeof fn === 'function') fn(); else alert("Module Prospects non chargé.");
      } catch (e) { console.error(e); alert("Impossible d'ouvrir la page Prospects."); }
    });

    // Masquer propres entrées en fonction des modules actifs
    (async () => {
      const mods = await getActiveModules();
      const toggleLi = (btnId, show) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const li = btn.closest('li') || btn;
        if (show) { li.removeAttribute('hidden'); li.style.display = ''; }
        else { li.setAttribute('hidden', ''); li.style.display = 'none'; }
      };
      toggleLi('btn-param-cotisations',  !!mods.cotisations);
      toggleLi('btn-param-prospects',    !!mods.prospects);
      toggleLi('btn-param-modes',        !!mods.modes_paiement);
    })();

    // Sync push/pull (boutons sans styles)
    document.getElementById('btn-sync-push')?.addEventListener('click', async () => {
      if (!confirm("Envoyer TOUTE la base locale vers Neon (création/mise à jour) ?")) return;
      showBusy('Envoi vers Neon en cours…');
      try {
        window.__syncBadgeSet?.('Envoi en cours…', '#b45309');
        let r;
        if (window.electronAPI?.syncPushBootstrapRefs) {
          r = await window.electronAPI.syncPushBootstrapRefs();
        } else {
          r = await window.electronAPI.syncPushAll?.();
        }
        hideBusy();
        if (r?.ok) {
          const c = r.counts || {};
          window.__syncBadgeSet?.('Synchronisé (push)', '#065f46');
          alert(
            "✅ Push terminé.\n\n" +
            `• Unités: ${c.unites ?? '—'}\n` +
            `• Familles: ${c.familles ?? '—'}\n` +
            `• Catégories: ${c.categories ?? '—'}\n` +
            `• Adhérents: ${c.adherents ?? '—'}\n` +
            `• Fournisseurs: ${c.fournisseurs ?? '—'}\n` +
            `• Produits: ${c.produits ?? '—'}\n` +
            `• Modes de paiement: ${c.modes_paiement ?? '—'}`
          );
          try {
            window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
            const pullRes = await window.electronAPI.syncPullAll?.();
            if (pullRes?.ok) window.__syncBadgeSet?.('Données à jour', '#065f46');
          } catch {}
        } else {
          window.__syncBadgeSet?.('Échec envoi', '#9f1239');
          alert("Push KO : " + (r?.error || 'inconnu'));
        }
      } catch (e) {
        hideBusy();
        window.__syncBadgeSet?.('Échec envoi', '#9f1239');
        alert("Push KO : " + (e?.message || e));
      }
    });

    document.getElementById('btn-sync-pull')?.addEventListener('click', async () => {
      if (!confirm("Remplacer/mettre à jour la base LOCALE depuis Neon ?")) return;
      showBusy('Récupération depuis Neon…');
      try {
        window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
        const r = await window.electronAPI.syncPullAll?.();
        hideBusy();
        if (r?.ok) {
          const c = r.counts || {};
          window.__syncBadgeSet?.('Synchronisé (pull)', '#065f46');
          alert(
            "✅ Pull terminé.\n\n" +
            `• Unités: ${c.unites ?? '—'}\n` +
            `• Familles: ${c.familles ?? '—'}\n` +
            `• Catégories: ${c.categories ?? '—'}\n` +
            `• Adhérents: ${c.adherents ?? '—'}\n` +
            `• Fournisseurs: ${c.fournisseurs ?? '—'}\n` +
            `• Produits: ${c.produits ?? '—'}\n` +
            `• Modes de paiement: ${c.modes_paiement ?? '—'}`
          );
        } else {
          window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
          alert("Pull KO : " + (r?.error || 'inconnu'));
        }
      } catch (e) {
        hideBusy();
        window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
        alert("Pull KO : " + (e?.message || e));
      }
    });
  }

  // ----------------------------
  // Utils
  // ----------------------------
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-dyn="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.dyn = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Impossible de charger ${src}`));
      document.head.appendChild(s);
    });
  }
  function formatEUR(v) {
    const n = Number(v || 0);
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  async function getApiBaseFromConfig() {
    try {
      const cfg = await (window.electronAPI?.getConfig?.() || {});
      return (cfg && cfg.api_base_url) ? cfg.api_base_url.replace(/\/+$/, '') : '';
    } catch { return ''; }
  }

  // ----------------------------
  // Catégories
  // ----------------------------
  async function renderGestionCategories() {
    const el = document.getElementById('parametres-souspage');
    if (!el) return;
    const api = window.electronAPI || {};
    const need = (k) => { if (!api[k]) throw new Error(`electronAPI.${k}() manquant`); return api[k]; };

    const getFamilies    = need('getFamilies');
    const createFamily   = need('createFamily');
    const renameFamily   = need('renameFamily');
    const deleteFamily   = need('deleteFamily');

    const getCategories  = need('getCategories');
    const createCategory = need('createCategory');
    const updateCategory = need('updateCategory');
    const moveCategory   = need('moveCategory');
    const deleteCategory = need('deleteCategory');

    let familles   = await getFamilies();
    let categories = await getCategories();

    const cssId = 'cats-accordion-style';
    if (!document.getElementById(cssId)) {
      const st = document.createElement('style');
      st.id = cssId;
      st.textContent = `
        .cats-acc { max-width: 980px; }
        .cats-actions-bar { display:flex; gap:8px; margin:10px 0 14px; flex-wrap:wrap; }
        details.cfam { border:1px solid #e6e6e6; border-radius:10px; background:#fff; margin-bottom:10px; overflow:hidden; }
        details.cfam[open] { box-shadow:0 4px 14px rgba(0,0,0,.06); }
        details.cfam > summary { list-style:none; cursor:pointer; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#fafafa; font-weight:600; }
        details.cfam > summary::-webkit-details-marker { display:none; }
        .fam-right { display:flex; align-items:center; gap:6px; }
        .fam-count { color:#666; font-size:12px; }
        .fam-body { padding:12px; }
        .cat-row { display:grid; grid-template-columns: 1fr 240px auto; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid #f0f0f0; }
        .cat-row:last-child { border-bottom:none; }
        .add-line { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
        .muted { color:#777; font-size:12px; }
        .empty { padding:6px 0; color:#777; }
        input, select { padding:6px 8px; }
      `;
      document.head.appendChild(st);
    }

    function render() {
      const catsByFam = new Map();
      familles.forEach(f => catsByFam.set(String(f.id), []));
      categories.forEach(c => {
        const key = String(c.famille_id ?? '');
        if (catsByFam.has(key)) catsByFam.get(key).push(c);
      });

      el.innerHTML = `
        <div class="cats-acc">
          <h3>Familles & Catégories</h3>
          <div class="muted">Clique une famille pour voir/modifier ses catégories.</div>

          <div class="cats-actions-bar">
            <input id="new-fam-name" placeholder="Nouvelle famille…">
            <button id="add-fam" class="btn">Ajouter la famille</button>
          </div>

          ${familles.length === 0 ? `
            <div class="empty">Aucune famille pour le moment.</div>
          ` : familles.map((f, i) => {
            const list = (catsByFam.get(String(f.id)) || []);
            return `
              <details class="cfam" data-fam-id="${f.id}" ${i===0 ? 'open' : ''}>
                <summary>
                  <span>${f.nom}</span>
                  <span class="fam-right">
                    <span class="fam-count">${list.length} cat.</span>
                    <button class="fam-rename btn btn-ghost" data-id="${f.id}" title="Renommer">✏️</button>
                    <button class="fam-del btn btn-ghost" data-id="${f.id}" title="Supprimer">🗑️</button>
                  </span>
                </summary>
                <div class="fam-body">
                  ${list.length === 0 ? `<div class="empty">Aucune catégorie dans cette famille.</div>` : `
                    ${list.map(c => `
                      <div class="cat-row" data-cat-id="${c.id}">
                        <input class="cat-name" value="${c.nom}">
                        <select class="cat-move" data-id="${c.id}">
                          ${familles.map(ff => `
                            <option value="${ff.id}" ${String(ff.id)===String(c.famille_id)?'selected':''}>${ff.nom}</option>
                          `).join('')}
                        </select>
                        <div class="cat-actions">
                          <button class="cat-save btn" data-id="${c.id}">Enregistrer</button>
                          <button class="cat-del btn" data-id="${c.id}">Supprimer</button>
                        </div>
                      </div>
                    `).join('')}
                  `}
                  <div class="add-line">
                    <input class="new-cat-name" placeholder="Nouvelle catégorie…">
                    <button class="add-cat btn" data-fam-id="${f.id}">Ajouter</button>
                  </div>
                </div>
              </details>
            `;
          }).join('')}
        </div>
      `;
    }

    render();

    el.addEventListener('click', async (e) => {
      const t = e.target;

      if (t.id === 'add-fam') {
        const nom = (el.querySelector('#new-fam-name')?.value || '').trim();
        if (!nom) return;
        await createFamily(nom);
        familles   = await getFamilies();
        categories = await getCategories();
        el.querySelector('#new-fam-name').value = '';
        render();
        return;
      }

      if (t.classList.contains('fam-rename')) {
        e.stopPropagation();
        const id  = Number(t.dataset.id);
        const fam = familles.find(x => x.id === id);
        const nv  = prompt('Nouveau nom de famille :', fam?.nom || '');
        if (!nv) return;
        await renameFamily({ id, nom: nv.trim() });
        familles = await getFamilies();
        render();
        return;
      }

      if (t.classList.contains('fam-del')) {
        e.stopPropagation();
        const id = Number(t.dataset.id);
        const hasCats = categories.some(c => String(c.famille_id) === String(id));
        if (hasCats) { alert('Impossible : la famille contient des catégories.'); return; }
        if (!confirm('Supprimer cette famille ?')) return;
        await deleteFamily(id);
        familles   = await getFamilies();
        categories = await getCategories();
        render();
        return;
      }

      if (t.classList.contains('add-cat')) {
        const famId = Number(t.dataset.famId);
        const details = t.closest('details');
        const nameInp = details?.querySelector('.new-cat-name');
        const nom = (nameInp?.value || '').trim();
        if (!nom) return;
        await createCategory({ nom, familleId: famId });
        categories = await getCategories();
        nameInp.value = '';
        render();
        const pane = el.querySelector(`details[data-fam-id="${famId}"]`);
        if (pane) pane.open = true;
        return;
      }

      if (t.classList.contains('cat-save')) {
        const id   = Number(t.dataset.id);
        const row  = t.closest('.cat-row');
        const name = row?.querySelector('.cat-name')?.value.trim();
        if (!name) return;
        await updateCategory({ id, nom: name });
        categories = await getCategories();
        render();
        const cat = categories.find(c => c.id === id);
        if (cat) {
          const pane = el.querySelector(`details[data-fam-id="${cat.famille_id}"]`);
          if (pane) pane.open = true;
        }
        return;
      }

      if (t.classList.contains('cat-del')) {
        const id = Number(t.dataset.id);
        if (!confirm('Supprimer cette catégorie ?')) return;
        try {
          await deleteCategory(id);
          categories = await getCategories();
          render();
        } catch (err) {
          alert(err?.message || "Suppression impossible (catégorie utilisée).");
        }
        return;
      }
    });

    el.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.classList.contains('cat-move')) {
        const id    = Number(t.dataset.id);
        const famId = Number(t.value);
        await moveCategory({ id, familleId: famId });
        categories = await getCategories();
        render();
        const pane = el.querySelector(`details[data-fam-id="${famId}"]`);
        if (pane) pane.open = true;
      }
    });
  }

  // ----------------------------
  // Unités
  // ----------------------------
  async function renderGestionUnites() {
    const container = document.getElementById('parametres-souspage');
    const unites = await window.electronAPI.getUnites();
    container.innerHTML = `
      <h3>Gestion des unités de mesure</h3>
      <form id="form-unite" style="display:flex; gap:8px; flex-wrap:wrap; align-items:end;">
        <input name="nom" placeholder="Nouvelle unité (ex: kg, litre, pièce)" required>
        <button type="submit" class="btn">Ajouter</button>
      </form>
      <br>
      <table class="table" width="100%" style="border-collapse: collapse;">
        <thead>
          <tr><th>Nom</th><th>Action</th></tr>
        </thead>
        <tbody id="liste-unites">
          ${unites.map(u => `
            <tr data-id="${u.id}">
              <td>
                <span class="nom-unite">${u.nom}</span>
                <input type="text" class="edit-unite" value="${u.nom}" style="display:none; width: 100%;">
              </td>
              <td>
                <button class="btn btn-ghost btn-edit">Modifier</button>
                <button class="btn btn-primary btn-save" style="display:none;">Enregistrer</button>
                <button class="btn btn-danger btn-supprimer">Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('form-unite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = e.target.nom.value.trim();
      if (!nom.length) return;
      await window.electronAPI.ajouterUnite(nom);
      renderGestionUnites();
    });

    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        row.querySelector('.nom-unite').style.display = 'none';
        row.querySelector('.edit-unite').style.display = 'inline-block';
        row.querySelector('.btn-edit').style.display = 'none';
        row.querySelector('.btn-save').style.display = 'inline-block';
      });
    });
    container.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = row.dataset.id;
        const newName = row.querySelector('.edit-unite').value.trim();
        if (!newName.length) return;
        await window.electronAPI.modifierUnite(parseInt(id,10), newName);
        renderGestionUnites();
      });
    });
    container.querySelectorAll('.btn-supprimer').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = parseInt(row.dataset.id,10);
        const result = await window.electronAPI.supprimerUnite(id);
        if (typeof result === 'string') showAlertModal(result);
        else renderGestionUnites();
      });
    });
  }

  // ----------------------------
  // Historique des ventes
  // ----------------------------
  async function renderHistoriqueFactures() {
    const container = document.getElementById('page-content');
    if (!container) return;

    const ventes = await window.electronAPI.getHistoriqueVentes();
    const ventesAvecProduits = await Promise.all(
      ventes.map(async (v) => {
        const details = await window.electronAPI.getDetailsVente(v.id);
        const header  = details.header || details;
        const lignes  = details.lignes || [];
        const totalProduits = Number(v.total ?? header.total ?? 0);
        const frais         = Number(v.frais_paiement ?? header.frais_paiement ?? 0) || 0;
        const cotisation    = Number(v.cotisation    ?? header.cotisation    ?? 0) || 0;
        const totalAffiche  = totalProduits + cotisation + frais;
        const adherent = `${v.adherent_nom || header.adherent_nom || ''} ${v.adherent_prenom || header.adherent_prenom || ''}`.trim();
        return { vente_id: v.id, date_vente: v.date_vente, adherent, mode_paiement_nom: (v.mode_paiement_nom || header.mode_paiement_nom || '—'), total_affiche: totalAffiche };
      })
    );

    container.innerHTML = `
      <h2>Historique des ventes</h2>
      <input type="text" id="recherche-vente"
        placeholder="Rechercher…"
        style="margin-bottom: 10px; width: 100%;">

      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Adhérent</th>
            <th>Total</th>
            <th>Paiement</th>
            <th>Détail</th>
          </tr>
        </thead>
        <tbody id="ventes-tbody">
          ${ventesAvecProduits.map(v => `
            <tr>
              <td>${new Date(v.date_vente).toLocaleString()}</td>
              <td>${v.adherent || '—'}</td>
              <td>${v.total_affiche.toFixed(2)} €</td>
              <td>${v.mode_paiement_nom || '—'}</td>
              <td><button data-id="${v.vente_id}" class="btn voir-detail-btn">Voir</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div id="facture-popup" class="modal-overlay" style="display:none;">
        <div class="modal">
          <div id="facture-detail"></div>
          <div style="text-align: right; margin-top: 10px;">
            <button id="btn-fermer-facture" class="btn">Fermer</button>
          </div>
        </div>
      </div>
    `;

    const input = document.getElementById('recherche-vente');
    const rows = Array.from(document.querySelectorAll('#ventes-tbody tr'));
    let debounce;
    input.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        rows.forEach(tr => {
          const idx = (tr.textContent || '').toLowerCase();
          tr.style.display = idx.includes(q) ? '' : 'none';
        });
      }, 80);
    });

    document.querySelectorAll('.voir-detail-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const details = await window.electronAPI.getDetailsVente(id);
        const header = details.header || details;
        const lignes = details.lignes || [];

        const montantCotisation = Number(header.cotisation || details.cotisation || 0);
        const fraisPaiement = Number(header.frais_paiement || 0);

        const lignesCalc = lignes.map(l => {
          const q = Number(l.quantite || 0);
          const lineTotal = (l.prix != null && l.prix !== '')
            ? Number(l.prix)
            : Number(q) * Number(l.prix_unitaire || 0);
          const puOrig = (l.prix_unitaire != null && l.prix_unitaire !== '')
            ? Number(l.prix_unitaire)
            : (q > 0 ? lineTotal / q : 0);
          const remise = Number(l.remise_percent || 0);
          const puRemise = puOrig * (1 - remise / 100);
          return { produit_nom: l.produit_nom || '', qte: q, puOrig, remise, puRemise, lineTotal };
        });

        const totalProduits = lignes.reduce((s, l) => {
          const q   = Number(l.quantite || 0);
          const tot = (l.prix != null && l.prix !== '')
            ? Number(l.prix)
            : Number(q) * Number(l.prix_unitaire || 0);
          return s + (Number.isFinite(tot) ? tot : 0);
        }, 0);
        const totalGlobal   = totalProduits + montantCotisation + fraisPaiement;

        const html = `
          <h3>Détail de la vente #${id}</h3>
          <p><strong>Date :</strong> ${new Date(header.date_vente).toLocaleString()}</p>
          <p><strong>Adhérent :</strong> ${(header.adherent_nom || '')} ${(header.adherent_prenom || '')}</p>
          <p><strong>Mode de paiement :</strong> ${header.mode_paiement_nom || '—'}</p>
          <table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse: collapse;">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Qté</th>
                <th>PU</th>
                <th>Remise</th>
                <th>PU remisé</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${lignesCalc.map(l => `
                <tr>
                  <td>${l.produit_nom}</td>
                  <td>${l.qte}</td>
                  <td>${l.puOrig.toFixed(2)} €</td>
                  <td>${l.remise.toFixed(2)} %</td>
                  <td>${l.puRemise.toFixed(2)} €</td>
                  <td>${l.lineTotal.toFixed(2)} €</td>
                </tr>
              `).join('')}
              ${montantCotisation > 0 ? `
                <tr>
                  <td><em>Cotisation</em></td>
                  <td>—</td>
                  <td colspan="3">${montantCotisation.toFixed(2)} €</td>
                  <td>${montantCotisation.toFixed(2)} €</td>
                </tr>
              ` : ''}
              ${fraisPaiement > 0 ? `
                <tr>
                  <td><em>Frais de paiement</em></td>
                  <td>—</td>
                  <td colspan="3">${fraisPaiement.toFixed(2)} €</td>
                  <td>${fraisPaiement.toFixed(2)} €</td>
                </tr>
              ` : ''}
            </tbody>
          </table>
          <p style="margin-top: 10px;">
            <strong>Total produits :</strong> ${totalProduits.toFixed(2)} €<br>
            ${fraisPaiement > 0 ? `<strong>Frais de paiement :</strong> ${fraisPaiement.toFixed(2)} €<br>` : ''}
            ${montantCotisation > 0 ? `<strong>Cotisation :</strong> ${montantCotisation.toFixed(2)} €<br>` : ''}
            <strong>Total :</strong> ${totalGlobal.toFixed(2)} €<br>
          </p>
        `;
        document.getElementById('facture-detail').innerHTML = html;
        document.getElementById('facture-popup').style.display = 'flex';
      });
    });

    document.getElementById('btn-fermer-facture').addEventListener('click', () => {
      const popup = document.getElementById('facture-popup');
      if (popup) popup.style.display = 'none';
    });
  }

  // ----------------------------
  // Modes de paiement
  // ----------------------------
  async function renderGestionModesPaiement() {
    const container = document.getElementById('parametres-souspage');
    const modes = await window.electronAPI.getModesPaiementAdmin();
    container.innerHTML = `
      <h3>Modes de paiement</h3>
      <form id="form-mp" style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
        <div><label>Nom<br><input name="nom" required></label></div>
        <div><label>Taux (%)<br><input name="taux_percent" type="number" step="0.01" value="0"></label></div>
        <div><label>Frais fixe (€)<br><input name="frais_fixe" type="number" step="0.01" value="0"></label></div>
        <div><label>Actif<br>
          <select name="actif"><option value="1">Oui</option><option value="0">Non</option></select>
        </label></div>
        <button type="submit" class="btn">Ajouter</button>
      </form>
      <br>
      <table class="table" width="100%" style="border-collapse: collapse;">
        <thead>
          <tr><th>Nom</th><th>Taux (%)</th><th>Frais fixe (€)</th><th>Actif</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${modes.map(m => `
            <tr data-id="${m.id}">
              <td><input class="mp-nom" value="${m.nom}"></td>
              <td><input class="mp-taux" type="number" step="0.01" value="${m.taux_percent}"></td>
              <td><input class="mp-fixe" type="number" step="0.01" value="${m.frais_fixe}"></td>
              <td>
                <select class="mp-actif">
                  <option value="1" ${m.actif ? 'selected':''}>Oui</option>
                  <option value="0" ${!m.actif ? 'selected':''}>Non</option>
                </select>
              </td>
              <td>
                <button class="mp-save btn">Enregistrer</button>
                <button class="mp-del btn">Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('form-mp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      await window.electronAPI.creerModePaiement({
        nom: f.nom.value.trim(),
        taux_percent: parseFloat(f.taux_percent.value || '0'),
        frais_fixe: parseFloat(f.frais_fixe.value || '0'),
        actif: Number(f.actif.value) === 1
      });
      renderGestionModesPaiement();
    });

    container.querySelectorAll('.mp-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr');
        await window.electronAPI.majModePaiement({
          id: Number(tr.dataset.id),
          nom: tr.querySelector('.mp-nom').value.trim(),
          taux_percent: parseFloat(tr.querySelector('.mp-taux').value || '0'),
          frais_fixe: parseFloat(tr.querySelector('.mp-fixe').value || '0'),
          actif: Number(tr.querySelector('.mp-actif').value) === 1
        });
        renderGestionModesPaiement();
      });
    });

    container.querySelectorAll('.mp-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr');
        await window.electronAPI.supprimerModePaiement(Number(tr.dataset.id));
        renderGestionModesPaiement();
      });
    });
  }

  // ----------------------------
  // Activation des modules
  // ----------------------------
  async function renderActivationModules() {
    const container = document.getElementById('page-content');
    if (!container) return;

    const current = await getActiveModules();
    let extMargin = 30;
    try {
      const res = await window.electronAPI.getVentesMargin?.();
      const v = Number(res?.percent);
      if (Number.isFinite(v) && v >= 0) extMargin = v;
    } catch { extMargin = 30; }

    const defs = {
      adherents:   { label: "Adhérents", desc: "Gestion des membres adhérents.", children: ["cotisations", "emails", "prospects"] },
      cotisations: { label: "Cotisations", desc: "Gestion des cotisations adhérents (min 5€).", dependsOn: ["adherents"] },
      emails:      { label: "E-mails", desc: "Envoi des factures par e-mail.", dependsOn: ["adherents"] },
      modes_paiement: { label: "Modes de paiement", desc: "Activer le sélecteur, les frais et la page d’admin." },
      prospects:   { label: "Prospects", desc: "Gestion prospects (dépend des adhérents).", dependsOn: ["adherents"] },
      ventes_exterieur: { label: "Vente aux extérieurs", desc: "Majoration configurable." },
      stocks:      { label: "Gestion des stocks", desc: "Mise à jour de stock & réceptions.", children: ["inventaire"] },
      inventaire:  { label: "Inventaire", desc: "Comptage physique.", dependsOn: ["stocks"] },
      fournisseurs:{ label: "Fournisseurs", desc: "Suivi des fournisseurs." },
      exports:     { label: "Exports / statistiques" },
      multiusers:  { label: "Multi-utilisateurs" }
    };

    if (!document.getElementById('modules-settings-style')) {
      const st = document.createElement('style');
      st.id = 'modules-settings-style';
      st.textContent = `
        .mods-wrap { max-width: 920px; }
        .mod-item { padding: 10px 12px; border: 1px solid #e6e6e6; border-radius: 10px; margin-bottom: 10px; background: #fafafa; }
        .mod-head { display:flex; align-items:center; gap:10px; }
        .mod-head label { font-weight: 700; }
        .mod-desc { color:#666; font-size: 12px; margin-left: 28px; margin-top: 4px; }
        .mod-children { margin-left: 22px; margin-top: 8px; display: grid; gap: 8px; }
        .mod-child { padding: 8px 10px; border: 1px dashed #ddd; border-radius: 8px; background: #fff; }
        .pill { display:inline-block; font-size:11px; padding:2px 6px; border-radius:999px; background:#eef3ff; border:1px solid #d7e2ff; color:#3756c5; margin-left: 6px; }
        .muted { color:#999; font-size: 12px; }
        .hr { height: 1px; background: #eee; margin: 14px 0; }
        input[type="number"] { padding: 6px 8px; }
      `;
      document.head.appendChild(st);
    }

    const getDepends = (key) => (defs[key]?.dependsOn || []);
    const getChildren = (key) => (defs[key]?.children || []);

    const renderItem = (key, level = 0) => {
      const def = defs[key]; if (!def) return '';
      const checked = !!current[key];
      const deps = getDepends(key);
      const disabled = deps.some(d => !current[d]);

      let headHtml = `
        <div class="mod-head">
          <input type="checkbox" id="mod-${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <label for="mod-${key}">${def.label}</label>
          ${deps.length ? `<span class="pill">dépend de : ${deps.join(', ')}</span>` : ''}
        </div>
        <div class="mod-desc">${def.desc || ''}</div>
      `;

      if (key === 'ventes_exterieur') {
        headHtml += `
          <div class="ext-margin" id="ext-margin-block" style="${checked ? '' : 'display:none;'}; margin-left:28px; margin-top:8px; display:flex; align-items:center; gap:8px;">
            <label>Majoration (%)</label>
            <input type="number" id="ext-margin-input" min="0" step="0.1" value="${extMargin}">
          </div>
        `;
      }

      const children = getChildren(key);
      const childrenHtml = children.length
        ? `<div class="mod-children">
            ${children.map(child => `
              <div class="mod-child" data-child-of="${key}">
                ${renderItem(child, level + 1)}
              </div>
            `).join('')}
          </div>` : '';

      return level === 0
        ? `<div class="mod-item" data-module="${key}">${headHtml}${childrenHtml}</div>`
        : `${headHtml}${childrenHtml}`;
    };

    const topLevelOrder = ["adherents", "ventes_exterieur", "stocks", "modes_paiement", "fournisseurs", "exports", "multiusers"]
      .filter(k => defs[k]);

    const html = `
      <div class="mods-wrap">
        <h2>Activation des modules</h2>
        <div class="muted">Activez/désactivez les modules. Les dépendances sont gérées automatiquement.</div>
        <div class="hr"></div>
        ${topLevelOrder.map(k => renderItem(k)).join('')}
        <div style="margin-top:16px; display:flex; gap:10px; align-items:center;">
          <button id="save-modules" class="btn">Enregistrer</button>
          <span class="muted" id="save-hint"></span>
        </div>
      </div>
    `;
    container.innerHTML = html;

    function refreshDisabledStates() {
      Object.keys(defs).forEach(key => {
        const deps = getDepends(key);
        const cb = document.getElementById(`mod-${key}`);
        if (!cb) return;
        const mustDisable = deps.some(d => !current[d]);
        cb.disabled = mustDisable;
        if (mustDisable) { cb.checked = false; current[key] = false; }
      });
    }
    function ensureParentsFor(key) {
      const deps = getDepends(key);
      deps.forEach(p => {
        if (!current[p]) {
          current[p] = true;
          const cbp = document.getElementById(`mod-${p}`);
          if (cbp) cbp.checked = true;
          ensureParentsFor(p);
        }
      });
    }

    Object.keys(defs).forEach(key => {
      const cb = document.getElementById(`mod-${key}`);
      if (!cb) return;
      cb.addEventListener('change', () => {
        const newVal = cb.checked;
        if (newVal) {
          ensureParentsFor(key); current[key] = true;
        } else {
          const stack = [key];
          while (stack.length) {
            const k = stack.pop();
            current[k] = false;
            const cbox = document.getElementById(`mod-${k}`);
            if (cbox) cbox.checked = false;
            (defs[k]?.children || []).forEach(ch => stack.push(ch));
          }
        }
        if (key === 'ventes_exterieur') {
          const block = document.getElementById('ext-margin-block');
          if (block) block.style.display = current.ventes_exterieur ? '' : 'none';
        }
        refreshDisabledStates();
        document.getElementById('save-hint').textContent = 'Modifications non enregistrées…';
      });
    });

    refreshDisabledStates();

    const btn = document.getElementById('save-modules');
    btn.addEventListener('click', async () => {
      try {
        const payload = { ...current };
        if (typeof payload.emails === 'boolean') payload.email = payload.emails;
        if (typeof payload.email  === 'boolean') payload.emails = payload.email;

        if (!payload.adherents) { payload.cotisations = false; payload.emails = false; payload.email = false; payload.prospects = false; }
        if (!payload.stocks) payload.inventaire = false;
        if (!payload.fournisseurs) payload.receptions = false;

        const input = document.getElementById('ext-margin-input');
        if (input) {
          let v = parseFloat(input.value);
          if (!Number.isFinite(v) || v < 0) v = 30;
          await window.electronAPI.setVentesMargin?.(v);
        }

        await saveActiveModules(payload);
        if (window.clearModsCache) window.clearModsCache();
        window.location.reload();
      } catch (e) {
        alert("Erreur lors de l'enregistrement : " + (e?.message || e));
      }
    });
  }

  // ----------------------------
  // Historique inventaires
  // ----------------------------
  async function renderHistoriqueInventaires() {
    const container = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    const apiBase = await getApiBaseFromConfig();
    if (!apiBase) {
      container.innerHTML = `<p>API non configurée (paramètre <code>api_base_url</code> manquant).</p>`;
      return;
    }
    showBusy('Chargement des sessions…');
    try {
      const r = await fetch(`${apiBase}/inventory/sessions`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const js = await r.json();
      if (!js?.ok) throw new Error(js?.error || 'Réponse invalide');
      const sessions = js.sessions || [];

      container.innerHTML = `
        <h3>Historique des inventaires</h3>
        <table class="table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr>
              <th>Nom</th><th>Début</th><th>Fin</th><th>Statut</th><th>Comptés / Total</th><th>Valeur inventaire</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map(s => `
              <tr data-id="${s.id}">
                <td>${s.name || '—'}</td>
                <td>${s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
                <td>${s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}</td>
                <td>${s.status}</td>
                <td>${s.counted_lines}/${s.total_products}</td>
                <td>${formatEUR(s.inventory_value)}</td>
                <td>
                  <button class="btn btn-see" data-id="${s.id}">Voir</button>
                  <button class="btn btn-csv" data-id="${s.id}">CSV</button>
                </td>
              </tr>
            `).join('')}
            ${sessions.length === 0 ? `<tr><td colspan="7">Aucune session.</td></tr>` : ''}
          </tbody>
        </table>
      `;

      container.querySelectorAll('.btn-see').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          await showInventoryDetailModal(apiBase, id);
        });
      });
      container.querySelectorAll('.btn-csv').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          await exportInventoryCSV(apiBase, id);
        });
      });

    } catch (e) {
      container.innerHTML = `<p>Erreur: ${e?.message || e}</p>`;
    } finally {
      hideBusy();
    }
  }
  async function fetchInventorySummary(apiBase, sessionId) {
    const r = await fetch(`${apiBase}/inventory/${sessionId}/summary`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const js = await r.json();
    if (!js?.ok) throw new Error(js?.error || 'Réponse invalide');
    return js;
  }
  async function showInventoryDetailModal(apiBase, sessionId) {
    showBusy('Chargement du détail…');
    try {
      const js = await fetchInventorySummary(apiBase, sessionId);
      const lines = js.lines || [];
      const sess  = js.session || {};
      const date  = sess.started_at ? new Date(sess.started_at).toLocaleString() : '—';

      const invValue = lines.reduce((acc, r) => acc + Number(r.counted_total || 0) * Number(r.prix || 0), 0);
      const counted  = lines.filter(r => Number(r.counted_total || 0) !== 0).length;

      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <div class="modal" style="background:#fff; border-radius:10px; padding:14px; max-width:95vw; max-height:90vh; overflow:auto;">
          <h3 style="margin-top:0;">Inventaire #${sessionId} — ${sess.name || ''}</h3>
          <div style="margin-bottom:8px; color:#555;">
            Date : <strong>${date}</strong> — Produits inventoriés : <strong>${counted}</strong> — Valeur : <strong>${formatEUR(invValue)}</strong>
          </div>
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Produit</th><th>Code</th><th>Stock initial</th><th>Compté</th><th>Écart</th><th>Prix</th><th>Valeur comptée</th>
              </tr>
            </thead>
            <tbody>
              ${lines.map(r => {
                const start = Number(r.stock_start || 0);
                const counted = Number(r.counted_total || 0);
                const delta = counted - start;
                const price = Number(r.prix || 0);
                const val = counted * price;
                return `
                  <tr>
                    <td>${r.nom || ''}</td>
                    <td>${r.code_barre || ''}</td>
                    <td>${start}</td>
                    <td>${counted}</td>
                    <td>${delta > 0 ? '+' : ''}${delta}</td>
                    <td>${formatEUR(price)}</td>
                    <td>${formatEUR(val)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div style="text-align:right; margin-top:10px;">
            <button class="btn modal-close">Fermer</button>
          </div>
        </div>
        <style>.modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:9999; }</style>
      `;
      document.body.appendChild(wrap);
      wrap.querySelector('.modal-close').addEventListener('click', () => wrap.remove());
      wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    } catch (e) {
      alert('Erreur: ' + (e?.message || e));
    } finally {
      hideBusy();
    }
  }
  function toCSV(rows) {
    const esc = (v) => { const s = String(v ?? ''); return (/[",;\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['product_id','nom','code_barre','stock_start','counted_total','ecart','prix','valeur_comptee'];
    const body = rows.map(r => {
      const start = Number(r.stock_start || 0);
      const counted = Number(r.counted_total || 0);
      const delta = counted - start;
      const price = Number(r.prix || 0);
      const val = counted * price;
      return [ r.product_id, r.nom || '', r.code_barre || '', start, counted, delta, price.toFixed(2), val.toFixed(2) ].map(esc).join(';');
    });
    return [header.join(';'), ...body].join('\n');
  }
  async function exportInventoryCSV(apiBase, sessionId) {
    showBusy('Préparation du CSV…');
    try {
      const js = await fetchInventorySummary(apiBase, sessionId);
      const csv = toCSV(js.lines || []);
      const name = (js.session?.name || `inventaire-${sessionId}`).replace(/[^\w\-]+/g, '_');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export CSV impossible : ' + (e?.message || e));
    } finally {
      hideBusy();
    }
  }

  // ----------------------------
  // Réglages e-mail (général)
  // ----------------------------
  async function renderEmailSettings() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('email-settings-style')) {
      const st = document.createElement('style');
      st.id = 'email-settings-style';
      st.textContent = `
        .email-settings .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); max-width:760px; }
        .email-settings .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
        .email-settings .row > div { display:flex; flex-direction:column; gap:6px; }
        .email-settings .muted { color:#6b7280; font-size:12px; }
        .email-settings .hr { height:1px; background:#eee; margin:14px 0; }
        .email-settings .inline { display:flex; align-items:center; gap:8px; }
        .email-settings input[type="text"], .email-settings input[type="email"], .email-settings input[type="password"], .email-settings input[type="number"], .email-settings select { padding:6px 8px; }
        .email-settings code { padding: 2px 6px; background: #f3f4f6; border-radius: 6px; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="email-settings">
        <div class="card">
          <h2 style="margin:0 0 8px 0;">Réglages e-mail d’envoi</h2>
          <div class="muted">Configure l’adresse expéditrice et, si besoin, ton serveur SMTP.</div>
          <div class="hr"></div>

          <div class="row">
            <div>
              <label>Provider</label>
              <select id="email-provider">
                <option value="gmail">Gmail (mot de passe d'application)</option>
                <option value="smtp">SMTP (personnalisé)</option>
                <option value="disabled">Désactivé</option>
              </select>
            </div>
            <div style="flex:1 1 260px;">
              <label>From (expéditeur)</label>
              <input id="email-from" type="text" placeholder="ex: Coop'az <noreply@exemple.com>">
            </div>
          </div>

          <div class="row">
            <div style="flex:1 1 260px;">
              <label>User (login)</label>
              <input id="email-user" type="text" placeholder="utilisateur SMTP ou Gmail">
            </div>
            <div style="flex:1 1 260px;">
              <label>Mot de passe</label>
              <div class="inline">
                <input id="email-pass" type="password" style="flex:1;">
                <button type="button" id="toggle-pass" class="btn">Afficher</button>
              </div>
            </div>
          </div>

          <div id="smtp-block" style="display:none;">
            <div class="row">
              <div><label>Host<br><input id="smtp-host" type="text" placeholder="smtp.exemple.com"></label></div>
              <div><label>Port<br><input id="smtp-port" type="number" placeholder="587"></label></div>
              <div class="inline" style="align-items:center; gap:6px; margin-top:8px;">
                <input id="smtp-secure" type="checkbox">
                <label for="smtp-secure">Secure (TLS implicite 465)</label>
              </div>
            </div>
          </div>

          <div class="hr"></div>

          <div class="row">
            <div class="inline" style="gap:8px;">
              <button id="btn-email-save" class="btn">Enregistrer</button>
              <span id="email-save-msg" class="muted"></span>
            </div>
          </div>

          <div class="row" style="margin-top:8px;">
            <div class="inline" style="gap:8px;">
              <input id="email-test-to" type="email" placeholder="destinataire test (ton email)">
              <button id="btn-email-test" class="btn">Envoyer un test</button>
              <span id="email-test-msg" class="muted"></span>
            </div>
          </div>
        </div>
      </div>
    `;
 
 const $ = (id) => host.querySelector(`#${id}`);

    const els = {
      provider: $('email-provider'),
      from:     $('email-from'),
      user:     $('email-user'),
      pass:     $('email-pass'),
      toggle:   $('toggle-pass'),
      smtp:     $('smtp-block'),
      host:     $('smtp-host'),
      port:     $('smtp-port'),
      secure:   $('smtp-secure'),
      save:     $('btn-email-save'),
      saveMsg:  $('email-save-msg'),
      testTo:   $('email-test-to'),
      testBtn:  $('btn-email-test'),
      testMsg:  $('email-test-msg'),
    };
    function setMsg(el, msg, ok=true) {
      if (!el) return;
      el.textContent = msg || '';
      el.classList.remove('ok','danger');
      if (!ok) el.classList.add('danger');
    }
    function applyProviderUI() {
      const p = els.provider.value;
      const isSMTP = p === 'smtp';
      const isDisabled = p === 'disabled';
      els.smtp.style.display = isSMTP ? '' : 'none';
      els.from.disabled = isDisabled;
      els.user.disabled = isDisabled;
      els.pass.disabled = isDisabled;
    }
    els.provider.addEventListener('change', applyProviderUI);
    els.toggle.addEventListener('click', () => {
      els.pass.type = (els.pass.type === 'password') ? 'text' : 'password';
      els.toggle.textContent = (els.pass.type === 'password') ? 'Afficher' : 'Masquer';
    });

    try {
      const r = await window.electronAPI.emailGetSettings?.();
      if (r?.ok) {
        const s = r.settings || {};
        els.provider.value = s.provider || 'gmail';
        els.from.value     = s.from || '';
        els.user.value     = s.user || '';
        els.pass.value     = '';
        els.host.value     = s.host || '';
        els.port.value     = (s.port != null ? s.port : '');
        els.secure.checked = !!s.secure;
      } else {
        setMsg(els.saveMsg, r?.error || 'Impossible de charger la configuration', false);
      }
    } catch (e) {
      setMsg(els.saveMsg, e?.message || String(e), false);
    }
    applyProviderUI();

    els.save.addEventListener('click', async () => {
      try {
        setMsg(els.saveMsg, 'Enregistrement…', true);
        const payload = {
          provider: els.provider.value,
          from: els.from.value.trim() || undefined,
          user: els.user.value.trim() || undefined,
          pass: els.pass.value || undefined,
          host: els.host.value.trim() || undefined,
          port: els.port.value ? Number(els.port.value) : undefined,
          secure: !!els.secure.checked,
        };
        const r = await window.electronAPI.emailSetSettings?.(payload);
        els.pass.value = '';
        if (!r?.ok) return setMsg(els.saveMsg, r?.error || 'Échec de l’enregistrement', false);
        setMsg(els.saveMsg, 'Réglages enregistrés ✅', true);
      } catch (e) {
        setMsg(els.saveMsg, e?.message || String(e), false);
      }
    });

    els.testBtn.addEventListener('click', async () => {
      const to = els.testTo.value.trim();
      if (!to) return setMsg(els.testMsg, 'Indique une adresse destinataire pour le test', false);
      try {
        setMsg(els.testMsg, 'Envoi du test…', true);
        const r = await window.electronAPI.emailTestSend?.({
          to, subject: '[Test] Coopaz multi-tenant', text: 'Ceci est un test de configuration.'
        });
        if (!r?.ok) return setMsg(els.testMsg, r?.error || 'Échec de l’envoi du test', false);
        setMsg(els.testMsg, 'Email de test envoyé ✅', true);
      } catch (e) {
        setMsg(els.testMsg, e?.message || String(e), false);
      }
    });
  }

  // ----------------------------
// Logo & Nom (branding via API Neon BYTEA)
// ----------------------------
async function renderTenantBrandingSettings() {
  const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
  if (!host) return;

  // besoin de la base API
  async function getApiBaseFromConfig() {
    try {
      const cfg = await (window.electronAPI?.getConfig?.() || {});
      return (cfg && cfg.api_base_url) ? cfg.api_base_url.replace(/\/+$/, '') : '';
    } catch { return ''; }
  }
  const apiBase = await getApiBaseFromConfig();
  if (!apiBase) {
    host.innerHTML = `<div class="logo-card"><h2>Logo & nom</h2><p>API non configurée (<code>api_base_url</code> manquant).</p></div>`;
    return;
  }

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
      <div class="muted">Stocké dans Neon. Visible pour tous les postes connectés à ce tenant.</div>
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

  // charge l'état actuel depuis l'API
  async function loadMeta() {
    const r = await fetch(`${apiBase}/branding`, { credentials: 'include', headers: { 'Authorization': localStorage.getItem('auth_token') ? `Bearer ${localStorage.getItem('auth_token')}` : '' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const js = await r.json();
    if (!js?.ok) throw new Error(js?.error || 'Réponse invalide');
    if (typeof js.name === 'string') nameInput.value = js.name;

    if (js.has_logo) {
      const url = `${apiBase}/branding/logo?ts=${Date.now()}`; // cache-busting léger
      prev.src = url;
      prev.style.display = '';
      empty.style.display = 'none';
      // met aussi le header en live
      window.__refreshTenantLogo__?.(url);
    } else {
      prev.style.display = 'none';
      empty.style.display = '';
      window.__refreshTenantLogo__?.('');
    }
    if (js.name) window.__refreshTenantName__?.(js.name);
  }

  try { await loadMeta(); } catch (e) { msg('Impossible de charger le branding', false); }

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
      const payload = {};
      payload.name = (nameInput.value ?? '').toString();
      if (selectedDataUrl) payload.logoDataUrl = selectedDataUrl;

      const r = await fetch(`${apiBase}/branding`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('auth_token') ? { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const js = await r.json().catch(()=>null);
      if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);

      // refresh UI header + preview
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
      const r = await fetch(`${apiBase}/branding`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('auth_token') ? { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ deleteLogo: true })
      });
      const js = await r.json().catch(()=>null);
      if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
      await loadMeta();
      msg('Logo supprimé ✅');
    } catch (e) {
      msg(e?.message || String(e), false);
    }
  });
}


  // ----------------------------
  // Admin Tenants (super admin)
  // ----------------------------
  async function renderTenantsAdmin() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('tenants-admin-style2')) {
      const st = document.createElement('style');
      st.id = 'tenants-admin-style2';
      st.textContent = `
        .tadmin .layout { display:grid; grid-template-columns: 320px 1fr; gap:16px; align-items:start; }
        .tadmin .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow: 0 4px 14px rgba(0,0,0,.05); }
        .tadmin .list { max-height: 70vh; overflow:auto; }
        .tadmin .row { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
        .tadmin .muted { color:#6b7280; font-size:12px; }
        .tadmin .tabs { display:flex; gap:8px; border-bottom:1px solid #eee; margin:10px 0; }
        .tadmin .tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
        .tadmin .tab.active { background:#f3f4f6; font-weight:600; }
        .tadmin .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        .tadmin label { font-weight:600; font-size: 12px; }
        .tadmin input[type="text"], .tadmin input[type="email"], .tadmin input[type="password"], .tadmin input[type="number"], .tadmin select { padding:6px 8px; width:100%; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="tadmin">
        <h2>Gestion des épiceries (tenants)</h2>
        <div class="muted">Créer/modifier un tenant, gérer ses modules et sa configuration e-mail.</div>
        <div class="layout">
          <div class="card">
            <h3 style="margin-top:0;">Créer un tenant</h3>
            <div class="row">
              <div style="flex:1;"><label>Nom<br><input id="t-name"></label></div>
              <div style="flex:1;"><label>Company (optionnel)<br><input id="t-company"></label></div>
              <div style="flex:1;"><label>Admin e-mail<br><input id="t-email" type="email"></label></div>
              <div style="flex:1;"><label>Mot de passe provisoire<br><input id="t-pass" type="password"></label></div>
              <div><button id="t-create" class="btn">Créer</button></div>
            </div>
            <div id="t-create-msg" class="muted" style="margin-top:6px;"></div>
            <hr style="margin:12px 0;">
            <div class="row" style="justify-content:space-between;">
              <h3 style="margin:0;">Tenants</h3>
              <button id="t-refresh" class="btn">Rafraîchir</button>
            </div>
            <div id="t-list" class="list" style="margin-top:8px;">Chargement…</div>
          </div>

          <div class="card" id="t-panel">
            <div id="t-panel-empty" class="muted">Sélectionne un tenant à gauche.</div>
            <div id="t-panel-body" style="display:none;">
              <div class="row" style="justify-content:space-between;">
                <div>
                  <h3 id="t-title" style="margin:0; display:inline-block;">Tenant</h3>
                  <code id="t-id" style="margin-left:8px;"></code>
                </div>
                <div class="row" style="gap:8px;">
                  <button id="t-delete-soft" class="btn">Supprimer</button>
                  <button id="t-delete-hard" class="btn">Supprimer définitivement</button>
                </div>
              </div>
              <div class="tabs">
                <div class="tab active" data-tab="modules">Modules</div>
                <div class="tab" data-tab="email">E-mail</div>
              </div>
              <div id="tab-modules"></div>
              <div id="tab-email" style="display:none;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (sel) => host.querySelector(sel);
    const setMsg = (el, msg) => { if (el) el.textContent = msg || ''; };
    function tabShow(which) {
      ['modules','email'].forEach(t => {
        $(`#tab-${t}`).style.display = (t===which) ? '' : 'none';
        [...host.querySelectorAll(`.tab[data-tab="${t}"]`)].forEach(tab => tab.classList.toggle('active', t===which));
      });
    }

    $('#t-create')?.addEventListener('click', async () => {
      const name = $('#t-name').value.trim();
      const email = $('#t-email').value.trim();
      const pass  = $('#t-pass').value;
      const company = $('#t-company').value.trim() || name;
      setMsg($('#t-create-msg'), 'Création…');
      try {
        const r = await window.electronAPI.adminRegisterTenant?.({ tenant_name: name, email, password: pass, company_name: company });
        if (!r?.ok) throw new Error(r?.error || 'Échec');
        setMsg($('#t-create-msg'), `✅ Créé (id: ${r.tenant_id})`);
        await loadTenants();
      } catch (e) { setMsg($('#t-create-msg'), `Erreur: ${e?.message || e}`); }
    });

    async function loadTenants() {
      const box = $('#t-list');
      if (!box) return;
      box.textContent = 'Chargement…';

      try {
        let r = null;
        if (window.electronAPI?.adminListTenants) {
          r = await window.electronAPI.adminListTenants();
        }
        if ((!r || r.ok === false) && window.ApiClient?.admin?.listTenants) {
          r = await window.ApiClient.admin.listTenants();
        }
        if (!r?.ok) {
          const reason = r?.error || 'Réponse non OK ou IPC absent';
          box.innerHTML = `<div class="muted">Impossible de charger : ${reason}</div>`;
          console.debug('[tenants] adminListTenants failed:', r);
          return;
        }

        const rows = r.tenants || [];
        if (!rows.length) {
          box.innerHTML = `<div class="muted">Aucun tenant.</div>`;
          return;
        }

        box.innerHTML = rows.map(t => `
          <div class="item" data-id="${t.id}" style="padding:8px; border:1px solid #eee; border-radius:8px; margin-bottom:6px; cursor:pointer;">
            <div><strong>${t.name || '—'}</strong></div>
            <div class="muted">${t.company_name || '—'}</div>
            <div class="muted">${t.admin_email || '—'}</div>
          </div>
        `).join('');

        box.querySelectorAll('.item').forEach(div => {
          div.addEventListener('click', () => openTenant(
            div.dataset.id,
            rows.find(x => String(x.id) === String(div.dataset.id))
          ));
        });
      } catch (e) {
        box.innerHTML = `<div class="muted">Erreur: ${e?.message || e}</div>`;
        console.error('[tenants] loadTenants error:', e);
      }
    }

    $('#t-refresh')?.addEventListener('click', loadTenants);
    await loadTenants();

    async function openTenant(tenantId, meta) {
      $('#t-panel-empty').style.display = 'none';
      $('#t-panel-body').style.display = '';
      $('#t-title').textContent = meta?.name || 'Tenant';
      $('#t-id').textContent = tenantId || '';

      await renderAdminModules(tenantId, $('#tab-modules'));
      await renderAdminEmail(tenantId, $('#tab-email'));

      host.querySelectorAll('.tab').forEach(tab => { tab.onclick = () => tabShow(tab.dataset.tab); });
      tabShow('modules');

      const btnSoft = $('#t-delete-soft');
      const btnHard = $('#t-delete-hard');

      btnSoft.onclick = async () => {
        if (!window.electronAPI?.adminTenantDelete) { alert("Suppression indisponible (IPC manquant)."); return; }
        const name = meta?.name || `tenant #${tenantId}`;
        if (!confirm(`Supprimer "${name}" ? (soft delete)`)) return;
        try {
          const r = await window.electronAPI.adminTenantDelete(tenantId, false);
          if (!r?.ok) throw new Error(r?.error || 'Échec suppression');
          alert('Tenant supprimé (soft).');
          await loadTenants();
          $('#t-panel-empty').style.display = '';
          $('#t-panel-body').style.display = 'none';
        } catch (e) { alert('Suppression impossible : ' + (e?.message || e)); }
      };

      btnHard.onclick = async () => {
        if (!window.electronAPI?.adminTenantDelete) { alert("Suppression indisponible (IPC manquant)."); return; }
        const name = meta?.name || `tenant #${tenantId}`;
        const conf = prompt(
          `SUPPRESSION DÉFINITIVE de "${name}"\n\n` +
          '⚠️ IRRÉVERSIBLE. Toutes les données seront supprimées.\n\n' +
          'Tape OUI pour confirmer :'
        );
        if (conf !== 'OUI') return;
        try {
          const r = await window.electronAPI.adminTenantDelete(tenantId, true);
          if (!r?.ok) throw new Error(r?.error || 'Échec suppression définitive');
          alert('Tenant supprimé définitivement.');
          await loadTenants();
          $('#t-panel-empty').style.display = '';
          $('#t-panel-body').style.display = 'none';
        } catch (e) { alert('Suppression impossible : ' + (e?.message || e)); }
      };
    }

    async function renderAdminModules(tenantId, container) {
      const defs = {
        adherents:   { label: "Adhérents", desc: "Gestion des membres adhérents.", children: ["cotisations", "emails", "prospects"] },
        cotisations: { label: "Cotisations", desc: "Gestion des cotisations (min 5€).", dependsOn: ["adherents"] },
        emails:      { label: "E-mails", desc: "Envoi des factures par e-mail.", dependsOn: ["adherents"] },
        modes_paiement: { label: "Modes de paiement", desc: "Sélecteur, frais, page d’admin." },
        prospects:   { label: "Prospects", desc: "Invitations et conversion.", dependsOn: ["adherents"] },
        ventes_exterieur: { label: "Vente extérieurs", desc: "Majoration configurable." },
        stocks:      { label: "Stocks", desc: "Mouvements, réceptions.", children: ["inventaire"] },
        inventaire:  { label: "Inventaire", desc: "Comptage physique.", dependsOn: ["stocks"] },
        fournisseurs:{ label: "Fournisseurs", desc: "Suivi des fournisseurs." },
        exports:     { label: "Exports / stats" },
        multiusers:  { label: "Multi-utilisateurs" }
      };

      container.innerHTML = `<div class="muted">Chargement des modules…</div>`;
      let current = {};
      try {
        const r = await window.electronAPI.adminGetTenantModules?.(tenantId);
        current = (r?.modules) || {};
      } catch {}

      let extMargin = 30;
      try {
        const res = await window.electronAPI.getVentesMargin?.();
        const v = Number(res?.percent);
        if (Number.isFinite(v) && v >= 0) extMargin = v;
      } catch {}

      const topLevel = ["adherents","ventes_exterieur","stocks","modes_paiement","fournisseurs","exports","multiusers"].filter(k => defs[k]);

      function getDepends(k){ return defs[k]?.dependsOn || []; }
      function getChildren(k){ return defs[k]?.children || []; }

      function itemHtml(key, level=0) {
        const d = defs[key]; if (!d) return '';
        const checked = !!current[key];
        const deps = getDepends(key);
        const disabled = deps.some(dep => !current[dep]);
        let h = `
          <div class="row" style="align-items:center;">
            <input type="checkbox" id="am-${key}" ${checked?'checked':''} ${disabled?'disabled':''}>
            <label for="am-${key}">${d.label}</label>
          </div>
          <div class="muted">${d.desc || ''} ${deps.length?`(dépend de: ${deps.join(', ')})`:''}</div>
        `;
        if (key==='ventes_exterieur') {
          h += `
            <div id="am-ext" class="row" style="margin-top:6px; ${checked?'':'display:none;'}">
              <label>Majoration (%)</label>
              <input id="am-ext-margin" type="number" min="0" step="0.1" value="${extMargin}" style="width:120px;">
            </div>
          `;
        }
        const kids = getChildren(key);
        const kidsHtml = kids.length ?
          `<div style="margin-left:14px; display:grid; gap:8px; margin-top:8px;">
            ${kids.map(ch => `<div class="card" style="padding:10px;">${itemHtml(ch, level+1)}</div>`).join('')}
          </div>` : '';
        return level===0 ? `<div class="card" style="margin-bottom:10px;">${h}${kidsHtml}</div>` : `${h}${kidsHtml}`;
      }

      container.innerHTML = `
        <div>
          ${topLevel.map(k => itemHtml(k)).join('')}
          <div class="row" style="gap:10px; margin-top:10px;">
            <button id="am-save" class="btn">Enregistrer</button>
            <span id="am-msg" class="muted"></span>
          </div>
        </div>
      `;

      function refreshDisabled() {
        Object.keys(defs).forEach(k => {
          const deps = getDepends(k);
          const cb  = container.querySelector(`#am-${k}`);
          if (!cb) return;
          const dis = deps.some(d => !current[d]);
          cb.disabled = dis;
          if (dis) { cb.checked = false; current[k]=false; }
        });
      }
      function ensureParents(k) {
        getDepends(k).forEach(p => {
          if (!current[p]) {
            current[p]=true;
            const cbp= container.querySelector(`#am-${p}`);
            if (cbp) cbp.checked = true;
            ensureParents(p);
          }
        });
      }

      Object.keys(defs).forEach(k => {
        const cb = container.querySelector(`#am-${k}`);
        if (!cb) return;
        cb.addEventListener('change', () => {
          if (cb.checked) { ensureParents(k); current[k]=true; }
          else {
            const stack=[k];
            while(stack.length){
              const s=stack.pop();
              current[s]=false;
              const cbs=container.querySelector(`#am-${s}`);
              if (cbs) cbs.checked=false;
              (defs[s]?.children||[]).forEach(ch=>stack.push(ch));
            }
          }
          if (k==='ventes_exterieur') {
            const b = container.querySelector('#am-ext');
            if (b) b.style.display = current.ventes_exterieur ? '' : 'none';
          }
          refreshDisabled();
          setMsg(container.querySelector('#am-msg'), 'Modifications non enregistrées…');
        });
      });
      refreshDisabled();

      container.querySelector('#am-save')?.addEventListener('click', async () => {
        try {
          const payload = { ...current };
          if (!payload.adherents) { payload.cotisations=false; payload.emails=false; payload.prospects=false; }
          if (!payload.stocks) payload.inventaire=false;

          const inp = container.querySelector('#am-ext-margin');
          if (inp) {
            let v = parseFloat(inp.value);
            if (!Number.isFinite(v)||v<0) v=30;
            await window.electronAPI.setVentesMargin?.(v);
          }
          const r = await window.electronAPI.adminSetTenantModules?.(tenantId, payload);
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          setMsg(container.querySelector('#am-msg'), 'Modules enregistrés ✅');
        } catch (e) { setMsg(container.querySelector('#am-msg'), 'Erreur: '+(e?.message||e)); }
      });
    }

    async function renderAdminEmail(tenantId, container) {
      container.innerHTML = `<div class="muted">Chargement e-mail…</div>`;

      const html = `
        <div class="grid2">
          <div><label>Provider</label>
            <select id="ae-provider">
              <option value="gmail">Gmail (mot de passe d'application)</option>
              <option value="smtp">SMTP (personnalisé)</option>
              <option value="disabled">Désactivé</option>
            </select>
          </div>
          <div><label>From (expéditeur)</label><input id="ae-from" type="text" placeholder="Coop'az <noreply@exemple.com>"></div>
          <div><label>User</label><input id="ae-user" type="text"></div>
          <div><label>Mot de passe</label><input id="ae-pass" type="password"></div>
        </div>
        <div id="ae-smtp" class="grid2" style="margin-top:8px; display:none;">
          <div><label>Host</label><input id="ae-host" type="text" placeholder="smtp.exemple.com"></div>
          <div><label>Port</label><input id="ae-port" type="number" placeholder="587"></div>
          <div class="row" style="margin-top:6px; align-items:center;">
            <input id="ae-secure" type="checkbox"><span>TLS implicite (465)</span>
          </div>
        </div>
        <div class="row" style="gap:10px; margin-top:10px;">
          <button id="ae-save" class="btn">Enregistrer</button>
          <span id="ae-msg" class="muted"></span>
        </div>
        <hr style="margin:12px 0;">
        <div class="row" style="gap:10px;">
          <input id="ae-test-to" type="email" placeholder="destinataire test">
          <button id="ae-test" class="btn">Envoyer un test</button>
          <span id="ae-test-msg" class="muted"></span>
        </div>
      `;
      container.innerHTML = html;

      const $c = (sel) => container.querySelector(sel);
      function applyProviderUI() {
        const p = $c('#ae-provider').value;
        $c('#ae-smtp').style.display = (p==='smtp') ? '' : 'none';
        const dis = (p==='disabled');
        ['#ae-from','#ae-user','#ae-pass'].forEach(sel=>{
          const el = $c(sel); if (el) el.disabled = dis;
        });
      }
      $c('#ae-provider').addEventListener('change', applyProviderUI);

      try {
        const r = await window.electronAPI.adminEmailGetSettings?.(tenantId);
        if (r?.ok) {
          const s = r.settings || {};
          $c('#ae-provider').value = s.provider || 'gmail';
          $c('#ae-from').value     = s.from || '';
          $c('#ae-user').value     = s.user || '';
          $c('#ae-pass').value      = '';
          $c('#ae-host').value     = s.host || '';
          $c('#ae-port').value     = (s.port != null ? s.port : '');
          $c('#ae-secure').checked = !!s.secure;
        } else {
          $c('#ae-msg').textContent = r?.error || 'Impossible de charger la configuration';
        }
      } catch (e) {
        $c('#ae-msg').textContent = e?.message || String(e);
      }
      applyProviderUI();

      $c('#ae-save').addEventListener('click', async () => {
        try {
          $c('#ae-msg').textContent = 'Enregistrement…';
          const payload = {
            provider: $c('#ae-provider').value,
            from: $c('#ae-from').value.trim() || undefined,
            user: $c('#ae-user').value.trim() || undefined,
            pass: $c('#ae-pass').value || undefined,
            host: $c('#ae-host').value.trim() || undefined,
            port: $c('#ae-port').value ? Number($c('#ae-port').value) : undefined,
            secure: !!$c('#ae-secure').checked,
          };
          const r = await window.electronAPI.adminEmailSetSettings?.(tenantId, payload);
          $c('#ae-pass').value = '';
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          $c('#ae-msg').textContent = 'Réglages enregistrés ✅';
        } catch (e) { $c('#ae-msg').textContent = 'Erreur: '+(e?.message||e); }
      });

      $c('#ae-test').addEventListener('click', async () => {
        const to = $c('#ae-test-to').value.trim();
        if (!to) { $c('#ae-test-msg').textContent = 'Indique un destinataire'; return; }
        try {
          $c('#ae-test-msg').textContent = 'Envoi…';
          const r = await window.electronAPI.adminEmailTestSend?.(tenantId, { to, subject: '[Test] Config e-mail tenant', text: 'Ceci est un test.' });
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          $c('#ae-test-msg').textContent = 'Email de test envoyé ✅';
        } catch (e) { $c('#ae-test-msg').textContent = 'Erreur: '+(e?.message||e); }
      });
    }
  }

  // ----------------------------
  // Export global
  // ----------------------------
  window.PageParams = {
    renderParametresHome,
    renderHistoriqueFactures,
    renderGestionCategories,
    renderGestionUnites,
    renderGestionModesPaiement,
    renderActivationModules,
    renderTenantBrandingSettings, // ← expose la page Logo ici (nom aligné)
    renderProspectsPage: (...args) =>
      (window.PageProspects?.render || window.renderProspectsPage)?.(...args),
  };

  if (!window.renderParametresHome) {
    window.renderParametresHome = () => window.PageParams?.renderParametresHome?.();
  }

  // ➜ Appliquer le branding au démarrage (nom + logo rétablis après reload)
  applyBrandingFromStore();
})();
