// src/renderer/pages/parametres.js

(() => {
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

  // --- Modules : lecture/écriture centrées sur le TENANT, avec fallback local ---
async function getActiveModules() {
  try {
    if (window.electronAPI?.getTenantModules) {
      const r = await window.electronAPI.getTenantModules();
      if (r?.ok && r.modules) return r.modules;
    }
  } catch {}
  // Fallback : ancien config local
  try {
    return await (window.getMods?.() || window.electronAPI.getModules());
  } catch {
    return {};
  }
}

async function saveActiveModules(modules) {
  // 1) Source de vérité : côté tenant (API)
  if (window.electronAPI?.setTenantModules) {
    const r = await window.electronAPI.setTenantModules(modules);
    if (!r?.ok) throw new Error(r?.error || 'setTenantModules KO');
  }
  // 2) Compat : met à jour l’ancien config local aussi (si présent)
  if (window.electronAPI?.setModules) {
    try { await window.electronAPI.setModules(modules); } catch {}
  }
}


  function renderParametresHome() {
    const content = document.getElementById("page-content");
    content.innerHTML = `
      <h2>Paramètres</h2>



      <ul style="display: flex; gap: 20px; list-style: none; padding-left: 0; flex-wrap: wrap;">
        <li><button id="btn-param-import">📂 Import données</button></li>
        <li><button id="btn-param-historique">🔧 Historique des ventes</button></li>
        <li><button id="btn-param-cotisations">🔧 Cotisations</button></li>
        <li><button id="btn-param-historiquerecetpion">🔧 historique réception</button></li>
        <li><button id="btn-param-inv-histo">📦 Historique des inventaires</button></li>
        <li><button id="btn-param-categories">🗂️ Gérer les catégories</button></li>
        <li><button id="btn-param-unites">⚖️ Unités</button></li>
        <li><button id="btn-param-modes">💳 Modes de paiement</button></li>
        <li><button id="btn-param-modules">🧩 Modules</button></li>
        <li><button id="btn-param-prospects">👥 Prospects</button></li>
        <li><button id="btn-sync-push">☁️ Push produits (local → Neon)</button></li>
        <li><button id="btn-sync-pull">🔁 Pull produits (Neon → local)</button></li>
        <li><button id="btn-tenants-admin" style="display:none;">🏪 Tenants (Super admin)</button></li>
        <li><button id="btn-param-autres">🔧 Autres paramètres</button></li>

      </ul>
      <div id="parametres-souspage" style="margin-top: 20px;"></div>
    `;
    // --- Super admin? Afficher le bouton Tenants
// --- Helpers super admin ---
function decodeJwtPayload(tok) {
  try {
    const p = tok.split('.')[1];
    const json = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(
      json.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    ));
  } catch { return null; }
}

function showTenantButtonIfSuper(info) {
  const btnTen = document.getElementById('btn-tenants-admin');
  if (!btnTen) return;
  const isSuper =
    !!info?.is_super_admin ||
    info?.role === 'super_admin' ||
    info === true; // au cas où getAuthInfo() renverrait juste true

  btnTen.style.display = isSuper ? '' : 'none';
  if (isSuper && !btnTen.__bound) {
    btnTen.addEventListener('click', renderTenantsAdmin);
    btnTen.__bound = true;
  }
}

async function detectSuperAdmin() {
  // 1) Essayer via IPC
  try {
    if (window.electronAPI?.getAuthInfo) {
      const info = await window.electronAPI.getAuthInfo();
      if (info) { showTenantButtonIfSuper(info); return; }
    }
  } catch {}
  // 2) Fallback : via ApiClient (si déjà chargé)
  try {
    const tok = window.ApiClient?.getToken?.();
    if (tok) {
      const payload = decodeJwtPayload(tok);
      showTenantButtonIfSuper(payload);
      return;
    }
  } catch {}
  // 3) Fallback : token en localStorage
  try {
    const tok = localStorage.getItem('auth_token') || localStorage.getItem('mt_token') || localStorage.getItem('jwt');
    if (tok) {
      const payload = decodeJwtPayload(tok);
      showTenantButtonIfSuper(payload);
      return;
    }
  } catch {}
  // sinon on laisse caché
}


// EXPLIQUE MOI QUI JE SUIS (debug)
window.__debugAuth = async function () {
  let ipcInfo = null;
  try {
    ipcInfo = await (window.electronAPI?.getAuthInfo?.() ?? null);
    console.log('[auth] IPC getAuthInfo =>', ipcInfo);
  } catch (e) {
    console.log('[auth] IPC getAuthInfo error =>', e);
  }

  // util: base64url → json
  function decodeJwtPayload(token) {
    try {
      const part = token.split('.')[1];
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '==='.slice((base64.length + 3) % 4);
      const json = atob(padded);
      return JSON.parse(decodeURIComponent(
        Array.from(json).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
      ));
    } catch {
      return null;
    }
  }

  let tok = null, payload = null;
  try {
    tok =
      (window.ApiClient?.getToken?.() ?? null) ||  // ✅ appel en `?.()`
      localStorage.getItem('auth_token') ||
      localStorage.getItem('mt_token') ||
      localStorage.getItem('jwt');

    console.log('[auth] Token present?', !!tok);

    if (tok) payload = decodeJwtPayload(tok);
    console.log('[auth] JWT payload =>', payload);
  } catch (e) {
    console.log('[auth] JWT decode error =>', e);
  }

  const isSuper =
    !!payload?.is_super_admin || payload?.role === 'super_admin' ||
    !!ipcInfo?.is_super_admin || ipcInfo?.role === 'super_admin';

  console.log('[auth] isSuper computed =>', isSuper);
};



// Appel immédiat (peut déjà suffire si getAuthInfo est en place)
detectSuperAdmin();


window.__debugAuth && window.__debugAuth();



    // Voyant réseau/sync
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
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,.15)';
        el.style.display = 'inline-block';
      }
      function online(){ setStatus('En ligne', '#065f46'); }
      function offline(){ setStatus('Hors ligne', '#b91c1c'); }
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      if (navigator.onLine) online(); else offline();

      if (window.electronEvents && window.electronEvents.on) {
        window.electronEvents.on('ops:pushed',   (_e, p) => setStatus(`Envoyé: ${p?.count || 0}`, '#065f46'));
        window.electronEvents.on('data:refreshed', () => setStatus('Données à jour', '#065f46'));
      }

      window.__syncBadgeSet = setStatus;
    })();

    // === Initialisation du bloc Connexion ===
    // On charge le client API dynamiquement puis on branche les boutons.
    (async function setupMtAuthUI(){
      try {
        await loadScriptOnce('src/renderer/lib/apiClient.js');
        detectSuperAdmin(); // retente après que l'ApiClient soit dispo

      } catch (e) {
        console.error('apiClient.js introuvable', e);
        const s = document.getElementById('mt-status');
        if (s) s.textContent = 'Client API manquant';
        return;
      }

      const emailEl  = document.getElementById('mt-email');
      const passEl   = document.getElementById('mt-pass');
      const statusEl = document.getElementById('mt-status');
      const apiUrlEl = document.getElementById('mt-api-url');
      const btnLogin    = document.getElementById('mt-login');
      const btnRegister = document.getElementById('mt-register');

      function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

      // Affiche l’URL API et l’état de connexion
      try {
        // Préférence: lire la config de l’app si dispo (api_base_url), sinon ApiClient.API_URL
        const cfg = await (window.electronAPI?.getConfig?.() || {});
        const apiBase = (cfg && cfg.api_base_url) ? cfg.api_base_url.replace(/\/+$/, '') : (window.ApiClient?.API_URL || '—');
        if (apiUrlEl) apiUrlEl.textContent = apiBase || '—';
      } catch {
        if (apiUrlEl) apiUrlEl.textContent = window.ApiClient?.API_URL || '—';
      }

      setStatus(window.ApiClient?.getToken() ? 'Connecté ✅' : 'Non connecté');

      btnLogin?.addEventListener('click', async () => {
        try {
          setStatus('Connexion...');
          const r = await window.ApiClient.login(emailEl.value.trim(), passEl.value);
          setStatus(r?.token ? 'Connecté ✅' : 'Échec');
        } catch (e) {
          console.error(e);
          setStatus('Erreur: ' + (e?.data?.error || e.message));
        }
      });

      btnRegister?.addEventListener('click', async () => {
        const tenantName = prompt('Nom de la nouvelle épicerie (tenant) ?');
        if (!tenantName) return;
        try {
          setStatus('Création tenant...');
          const r = await window.ApiClient.registerTenant(tenantName.trim(), emailEl.value.trim(), passEl.value);
          setStatus(r?.token ? `Tenant créé: ${tenantName} ✅` : 'Échec création');
        } catch (e) {
          console.error(e);
          setStatus('Erreur: ' + (e?.data?.error || e.message));
        }
      });
    })();

    // Boutons → sous-pages
    document.getElementById('btn-param-import')         .addEventListener('click', () => window.PageImports.renderImportExcel());
    document.getElementById('btn-param-historique')     .addEventListener('click', () => window.PageParams.renderHistoriqueFactures());
    document.getElementById('btn-param-cotisations')    .addEventListener('click', () => window.renderCotisations?.());
    document.getElementById('btn-param-historiquerecetpion')  .addEventListener('click', () => window.PageReceptions?.renderReceptions?.());
    document.getElementById('btn-param-inv-histo')?.addEventListener('click', () => renderHistoriqueInventaires());
    document.getElementById('btn-param-categories')     .addEventListener('click', () => renderGestionCategories());
    document.getElementById('btn-param-unites')         .addEventListener('click', () => renderGestionUnites());
    document.getElementById('btn-param-modes')          .addEventListener('click', () => renderGestionModesPaiement());
    document.getElementById('btn-param-modules')        .addEventListener('click', () => renderActivationModules());
    document.getElementById('btn-param-autres')         .addEventListener('click', () => window.renderGestionParametres?.());

    // Prospects
    document.getElementById('btn-param-prospects')?.addEventListener('click', async () => {
      try {
const mods = await getActiveModules();
        if (!mods?.prospects) { alert("Le module Prospects n'est pas activé (Paramètres > Modules)."); return; }
        if (!window.PageProspects?.render) { await loadScriptOnce('src/renderer/pages/prospects.js'); }
        const fn = window.PageProspects?.render || window.renderProspectsPage;
        if (typeof fn === 'function') fn(); else alert("Module Prospects non chargé.");
      } catch (e) { console.error(e); alert("Impossible d'ouvrir la page Prospects."); }
    });

    // Masques si module OFF
    (async () => {
const mods = await getActiveModules();
      const btnCoti = document.getElementById('btn-param-cotisations');
      if (btnCoti) btnCoti.style.display = mods.cotisations ? '' : 'none';
      const btnPros = document.getElementById('btn-param-prospects');
      if (btnPros) btnPros.style.display = mods.prospects ? '' : 'none';
      const btnModes = document.getElementById('btn-param-modes');
      if (btnModes) btnModes.style.display = mods.modes_paiement ? '' : 'none';
    })();

    // === PUSH (local → Neon) : on réutilise TON bouton existant ===
    document.getElementById('btn-sync-push')?.addEventListener('click', async () => {
      if (!confirm("Envoyer TOUTE la base locale vers Neon (création/mise à jour) ?")) return;
      showBusy('Envoi vers Neon en cours…');
      try {
        window.__syncBadgeSet?.('Envoi en cours…', '#b45309');

        // On privilégie l’API "référentiels complets" si exposée (inclut adhérents + modes)
        let r;
        if (window.electronAPI?.syncPushBootstrapRefs) {
          r = await window.electronAPI.syncPushBootstrapRefs();
        } else {
          // fallback : ancien flux
          r = await window.electronAPI.syncPushAll();
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

          // petit pull derrière pour rafraîchir local (best effort)
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

    // === PULL (Neon → local) : on réutilise TON bouton existant ===
    document.getElementById('btn-sync-pull')?.addEventListener('click', async () => {
      if (!confirm("Remplacer/mettre à jour la base LOCALE depuis Neon ?")) return;
      showBusy('Récupération depuis Neon…');
      try {
        window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
        const r = await window.electronAPI.syncPullAll();
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

  // ----------------------------------------
  // Utils
  // ----------------------------------------
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

  // --- Paramètres → Catégories ---
  async function renderGestionCategories() {
    const el = document.getElementById('parametres-souspage');
    if (!el) return;

    const api = window.electronAPI || {};
    const need = (k) => {
      if (!api[k]) throw new Error(`electronAPI.${k}() manquant`);
      return api[k];
    };

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
        .cats-actions-bar { display:flex; gap:8px; margin:10px 0 14px; }
        details.cfam { border:1px solid #e6e6e6; border-radius:10px; background:#fff; margin-bottom:10px; overflow:hidden; }
        details.cfam[open] { box-shadow:0 4px 14px rgba(0,0,0,.06); }
        details.cfam > summary { list-style:none; cursor:pointer; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; background:#fafafa; font-weight:600; }
        details.cfam > summary::-webkit-details-marker { display:none; }
        .fam-right { display:flex; align-items:center; gap:6px; }
        .fam-count { color:#666; font-size:12px; }
        .fam-btn { padding:4px 8px; }
        .fam-body { padding:12px; }
        .cat-row { display:grid; grid-template-columns: 1fr 240px auto; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid #f0f0f0; }
        .cat-row:last-child { border-bottom:none; }
        .cat-actions button { padding:4px 8px; }
        .add-line { display:flex; gap:8px; margin-top:10px; }
        .muted { color:#777; font-size:12px; }
        .empty { padding:6px 0; color:#777; }
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
            <button id="add-fam">➕ Ajouter la famille</button>
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
                    <button class="fam-rename fam-btn" data-id="${f.id}">✏️</button>
                    <button class="fam-del fam-btn" data-id="${f.id}">🗑️</button>
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
                          <button class="cat-save" data-id="${c.id}">💾</button>
                          <button class="cat-del" data-id="${c.id}">🗑️</button>
                        </div>
                      </div>
                    `).join('')}
                  `}
                  <div class="add-line">
                    <input class="new-cat-name" placeholder="Nouvelle catégorie…">
                    <button class="add-cat" data-fam-id="${f.id}">➕ Ajouter</button>
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

  async function renderGestionUnites() {
    const container = document.getElementById('parametres-souspage');
    const unites = await window.electronAPI.getUnites();
    container.innerHTML = `
      <h3>Gestion des unités de mesure</h3>
      <form id="form-unite">
        <input name="nom" placeholder="Nouvelle unité (ex: kg, litre, pièce)" required style="padding: 5px;">
        <button type="submit">➕ Ajouter</button>
      </form>
      <br>
      <table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse: collapse;">
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
                <button class="btn-edit">✏️ Modifier</button>
                <button class="btn-save" style="display:none;">💾 Enregistrer</button>
                <button class="btn-supprimer">🗑️ Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('form-unite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = e.target.nom.value.trim();
      if (nom.length === 0) return;
      await window.electronAPI.ajouterUnite(nom);
      renderGestionUnites();
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        row.querySelector('.nom-unite').style.display = 'none';
        row.querySelector('.edit-unite').style.display = 'inline-block';
        row.querySelector('.btn-edit').style.display = 'none';
        row.querySelector('.btn-save').style.display = 'inline-block';
      });
    });

    document.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = row.dataset.id;
        const newName = row.querySelector('.edit-unite').value.trim();
        if (newName.length === 0) return;
        await window.electronAPI.modifierUnite(parseInt(id), newName);
        renderGestionUnites();
      });
    });

    document.querySelectorAll('.btn-supprimer').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = parseInt(row.dataset.id);
        const result = await window.electronAPI.supprimerUnite(id);
        if (typeof result === 'string') {
          showAlertModal(result);
        } else {
          renderGestionUnites();
        }
      });
    });
  }

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

        return {
          vente_id: v.id,
          date_vente: v.date_vente,
          adherent,
          mode_paiement_nom: (v.mode_paiement_nom || header.mode_paiement_nom || '—'),
          total_affiche: totalAffiche,
        };
      })
    );

    container.innerHTML = `
  <h2>Historique des ventes</h2>
  <input type="text" id="recherche-vente"
    placeholder="🔍 Rechercher par nom, date, produit, fournisseur, unité, code-barres, mode, total, n° de vente, cotisation, frais…"
    style="margin-bottom: 10px; padding: 6px; width: 100%;">

  <table class="historique-table">
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
        <td><button data-id="${v.vente_id}" class="voir-detail-btn">Voir</button></td>
      </tr>
    `).join('')}
  </tbody>
</table>

  <div id="facture-popup" class="modal-overlay" style="display:none;">
    <div class="modal">
      <div id="facture-detail"></div>
      <div style="text-align: right; margin-top: 10px;">
        <button id="btn-fermer-facture">Fermer</button>
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
          return {
            produit_nom: l.produit_nom || '',
            qte: q,
            puOrig,
            remise,
            puRemise,
            lineTotal
          };
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
  <table border="1" cellpadding="6" cellspacing="0" width="100%">
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
        <button type="submit">➕ Ajouter</button>
      </form>
      <br>
      <table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse: collapse;">
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
                <button class="mp-save">💾</button>
                <button class="mp-del">🗑️</button>
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

  async function renderActivationModules() {
    const container = document.getElementById('page-content');
    if (!container) return;

const current = await getActiveModules();

    let extMargin = 30;
    try {
      const res = await window.electronAPI.getVentesMargin();
      const v = Number(res?.percent);
      if (Number.isFinite(v) && v >= 0) extMargin = v;
    } catch { extMargin = 30; }

    const defs = {
      adherents:   { label: "Adhérents", desc: "Gestion des membres adhérents.", children: ["cotisations", "emails", "prospects"] },
      cotisations: { label: "Cotisations", desc: "Gestion des cotisations adhérents (min 5€).", dependsOn: ["adherents"], children: [] },
      emails:      { label: "E-mails", desc: "Envoi des factures par e-mail.", dependsOn: ["adherents"], children: [] },
      modes_paiement: { label: "Modes de paiement", desc: "Activer la gestion des moyens de paiement (sélecteur en caisse, frais éventuels, page d’admin).", children: [] },
      prospects:   { label: "Prospects", desc: "Gestion des prospects, invitations et conversion en adhérents.", dependsOn: ["adherents"], children: [] },
      ventes_exterieur: { label: "Vente aux extérieurs", desc: "Permet de vendre à des non-adhérents avec majoration configurable.", children: [] },
      stocks:      { label: "Gestion des stocks", desc: "Mise à jour automatique du stock et réceptions.", children: ["inventaire"] },
      inventaire:  { label: "Inventaire", desc: "Comptage et gestion des inventaires.", dependsOn: ["stocks"], children: [] },
      fournisseurs:{ label: "Fournisseurs", desc: "Ajout, modification et suivi des fournisseurs.", children: [] },
      exports:     { label: "Exports / statistiques", desc: "Exportation des données et statistiques.", children: [] },
      multiusers:  { label: "Multi-utilisateurs", desc: "Gestion des comptes utilisateurs.", children: [] }
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
        .save-row { margin-top:16px; display:flex; gap:10px; align-items:center; }
        .save-btn { padding: 10px 14px; border-radius: 8px; border: 1px solid #d9d9d9; cursor: pointer; font-weight: 600; }
        .save-btn[aria-busy="true"] { opacity:.6; pointer-events:none; }
        .ext-margin { margin-left: 28px; margin-top: 8px; display:flex; align-items:center; gap:8px; }
        .ext-margin input[type="number"] { width: 120px; padding: 4px 6px; }
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
          <div class="ext-margin" id="ext-margin-block" style="${checked ? '' : 'display:none;'}">
            <label>Majoration (%)</label>
            <input type="number" id="ext-margin-input" min="0" step="0.1" value="${extMargin}">
            <span class="muted">Appliquée sur les produits lors d'une vente extérieure.</span>
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
        <div class="save-row">
          <button id="save-modules" class="save-btn">Enregistrer</button>
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
        if (mustDisable) {
          cb.checked = false;
          current[key] = false;
        }
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
          ensureParentsFor(key);
          current[key] = true;
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
        btn.setAttribute('aria-busy', 'true');

        const payload = { ...current };
        if (typeof payload.emails === 'boolean') payload.email = payload.emails;
        if (typeof payload.email  === 'boolean') payload.emails = payload.email;

        if (!payload.adherents) {
          payload.cotisations = false;
          payload.emails = false;
          payload.email = false;
          payload.prospects = false;
        }
        if (!payload.stocks) payload.inventaire = false;
        if (!payload.fournisseurs) payload.receptions = false;

        const input = document.getElementById('ext-margin-input');
        if (input) {
          let v = parseFloat(input.value);
          if (!Number.isFinite(v) || v < 0) v = 30;
          await window.electronAPI.setVentesMargin(v);
        }

await saveActiveModules(payload);
        if (window.clearModsCache) window.clearModsCache();
        window.location.reload();
      } catch (e) {
        alert("Erreur lors de l'enregistrement : " + (e?.message || e));
      } finally {
        btn.removeAttribute('aria-busy');
      }
    });
  }
async function getApiBaseFromConfig() {
  try {
    const cfg = await (window.electronAPI?.getConfig?.() || {});
    return (cfg && cfg.api_base_url) ? cfg.api_base_url.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

function formatEUR(v) {
  const n = Number(v || 0);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

async function renderHistoriqueInventaires() {
  const container = document.getElementById('parametres-souspage') || document.getElementById('page-content');
  const apiBase = await getApiBaseFromConfig();
  if (!apiBase) {
    container.innerHTML = `<p style="color:#b00020">API non configurée (paramètre <code>api_base_url</code> manquant).</p>`;
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
      <div class="muted">Liste des sessions. Clique “Voir” pour le détail, ou exporte le CSV.</div>
      <table class="historique-table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr>
            <th style="border:1px solid #ddd; padding:6px;">Nom</th>
            <th style="border:1px solid #ddd; padding:6px;">Début</th>
            <th style="border:1px solid #ddd; padding:6px;">Fin</th>
            <th style="border:1px solid #ddd; padding:6px;">Statut</th>
            <th style="border:1px solid #ddd; padding:6px;">Comptés / Total</th>
            <th style="border:1px solid #ddd; padding:6px;">Valeur inventaire</th>
            <th style="border:1px solid #ddd; padding:6px;"></th>
          </tr>
        </thead>
        <tbody>
          ${sessions.map(s => `
            <tr data-id="${s.id}">
              <td style="border:1px solid #ddd; padding:6px;">${s.name || '—'}</td>
              <td style="border:1px solid #ddd; padding:6px;">${s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
              <td style="border:1px solid #ddd; padding:6px;">${s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}</td>
              <td style="border:1px solid #ddd; padding:6px;">${s.status}</td>
              <td style="border:1px solid #ddd; padding:6px;">${s.counted_lines}/${s.total_products}</td>
              <td style="border:1px solid #ddd; padding:6px;">${formatEUR(s.inventory_value)}</td>
              <td style="border:1px solid #ddd; padding:6px; white-space:nowrap;">
                <button class="btn-see" data-id="${s.id}">Voir</button>
                <button class="btn-csv" data-id="${s.id}">CSV</button>
              </td>
            </tr>
          `).join('')}
          ${sessions.length === 0 ? `<tr><td colspan="7" style="padding:8px;">Aucune session.</td></tr>` : ''}
        </tbody>
      </table>
    `;

    // Actions
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
    container.innerHTML = `<p style="color:#b00020">Erreur: ${e?.message || e}</p>`;
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

    // Valeur inventaire = somme(counted_total * prix)
    const invValue = lines.reduce((acc, r) => acc + Number(r.counted_total || 0) * Number(r.prix || 0), 0);
    const counted  = lines.filter(r => Number(r.counted_total || 0) !== 0).length;

    // Modale
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
              <th style="border:1px solid #ddd; padding:6px;">Produit</th>
              <th style="border:1px solid #ddd; padding:6px;">Code</th>
              <th style="border:1px solid #ddd; padding:6px;">Stock initial</th>
              <th style="border:1px solid #ddd; padding:6px;">Compté</th>
              <th style="border:1px solid #ddd; padding:6px;">Écart</th>
              <th style="border:1px solid #ddd; padding:6px;">Prix</th>
              <th style="border:1px solid #ddd; padding:6px;">Valeur comptée</th>
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
                  <td style="border:1px solid #ddd; padding:6px;">${r.nom || ''}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${r.code_barre || ''}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${start}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${counted}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${delta > 0 ? '+' : ''}${delta}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${formatEUR(price)}</td>
                  <td style="border:1px solid #ddd; padding:6px;">${formatEUR(val)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div style="text-align:right; margin-top:10px;">
          <button class="modal-close">Fermer</button>
        </div>
      </div>
      <style>
        .modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:9999; }
      </style>
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
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = ['product_id','nom','code_barre','stock_start','counted_total','ecart','prix','valeur_comptee'];
  const body = rows.map(r => {
    const start = Number(r.stock_start || 0);
    const counted = Number(r.counted_total || 0);
    const delta = counted - start;
    const price = Number(r.prix || 0);
    const val = counted * price;
    return [
      r.product_id, r.nom || '', r.code_barre || '',
      start, counted, delta, price.toFixed(2), val.toFixed(2)
    ].map(esc).join(';');
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
    a.href = url;
    a.download = `${name}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export CSV impossible : ' + (e?.message || e));
  } finally {
    hideBusy();
  }
}

async function renderTenantsAdmin() {
  const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
  if (!host) return;

  // Feuilles de style (une seule fois)
  if (!document.getElementById('tenants-admin-style')) {
    const st = document.createElement('style');
    st.id = 'tenants-admin-style';
    st.textContent = `
      .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow: 0 4px 14px rgba(0,0,0,.05); }
      .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
      .row > div { display:flex; flex-direction:column; gap:6px; }
      .muted { color:#6b7280; font-size:12px; }
      .table { width:100%; border-collapse:collapse; }
      .table th, .table td { border:1px solid #e5e7eb; padding:8px; }
      .table th { background:#f9fafb; text-align:left; }
      .right { text-align:right; }
    `;
    document.head.appendChild(st);
  }

  host.innerHTML = `
    <h2>Gestion des épiceries (tenants)</h2>
    <div class="muted">Réservé au super admin. Crée de nouvelles épiceries et visualise la liste existante.</div>
    <div style="height:8px;"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Créer une nouvelle épicerie</h3>
      <div class="row">
        <div><label>Nom de l'épicerie<br><input id="t-name" placeholder="Ex: Coop’az Azur"></label></div>
        <div><label>Email admin<br><input id="t-email" type="email" placeholder="gerant@epicerie.fr"></label></div>
        <div><label>Mot de passe provisoire<br><input id="t-pass" type="password" placeholder="Provisoire123!"></label></div>
        <div><label>Raison sociale (optionnel)<br><input id="t-company" placeholder="Raison sociale"></label></div>
        <div><button id="t-create">Créer le tenant</button></div>
      </div>
      <div id="t-result" class="muted" style="margin-top:6px;"></div>
    </div>

    <div style="height:16px;"></div>

    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <h3 style="margin:0;">Liste des tenants</h3>
        <button id="t-refresh">Rafraîchir</button>
      </div>
      <div id="t-list" style="margin-top:10px;">Chargement…</div>
    </div>
  `;

  const out = (msg) => { const el = document.getElementById('t-result'); if (el) el.textContent = msg || ''; };

  // Création tenant
  document.getElementById('t-create')?.addEventListener('click', async () => {
    const tenant_name = document.getElementById('t-name').value.trim();
    const email       = document.getElementById('t-email').value.trim();
    const password    = document.getElementById('t-pass').value;
    const company_name= document.getElementById('t-company').value.trim() || tenant_name;

    if (!tenant_name || !email || !password) {
      out('Champs requis manquants.'); return;
    }
    out('Création en cours…');

    try {
      const r = await window.electronAPI.adminRegisterTenant({ tenant_name, email, password, company_name });
      if (!r?.ok) throw new Error(r?.error || 'register-tenant KO');
      out(`✅ Créé — tenant_id: ${r.tenant_id}`);
      // rafraîchir la liste
      await loadTenants();
    } catch (e) {
      out('Erreur: ' + (e?.message || e));
    }
  });

  // Liste tenants
  async function loadTenants() {
    const box = document.getElementById('t-list');
    if (!box) return;
    box.textContent = 'Chargement…';
    try {
      // nécessite l’IPC adminListTenants (voir plus bas)
      const r = await (window.electronAPI?.adminListTenants?.() || null);
      if (!r?.ok) {
        box.innerHTML = `
          <div class="muted">Impossible de charger la liste (adminListTenants non dispo).<br>
          Tu peux déjà créer des tenants avec le formulaire ci-dessus.</div>`;
        return;
      }
      const rows = r.tenants || [];
      if (!rows.length) {
        box.innerHTML = `<div class="muted">Aucun tenant.</div>`;
        return;
      }
      box.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Company</th>
              <th>Tenant ID</th>
              <th>Admin (email)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(t => `
              <tr>
                <td>${t.name || '—'}</td>
                <td>${t.company_name || '—'}</td>
                <td><code>${t.id}</code></td>
                <td>${t.admin_email || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      box.innerHTML = `<div class="muted">Erreur: ${e?.message || e}</div>`;
    }
  }

  document.getElementById('t-refresh')?.addEventListener('click', loadTenants);
  await loadTenants();
}


  // === Export global ===
  window.PageParams = {
    renderParametresHome,
    renderHistoriqueFactures,
    renderGestionCategories,
    renderGestionUnites,
    renderGestionModesPaiement,
    renderActivationModules,
    renderProspectsPage: (...args) =>
      (window.PageProspects?.render || window.renderProspectsPage)?.(...args),
  };
})();
