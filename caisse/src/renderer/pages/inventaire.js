// src/renderer/pages/inventaire.js
(function () {
  const openProductEditor = (...args) => window.ProductEditor.openProductEditor(...args);

  /* ================== Utils UI (busy, row-busy) ================== */
  function ensureBusyOverlay() {
    if (document.getElementById('app-busy')) return;
    const div = document.createElement('div');
    div.id = 'app-busy';
    div.innerHTML = `
      <div class="busy-backdrop"></div>
      <div class="busy-panel">
        <div class="busy-spinner" aria-hidden="true"></div>
        <div id="busy-text">Veuillez patienter…</div>
      </div>
    `;
    document.body.appendChild(div);
  }
  function setBusy(on, message = 'Veuillez patienter…') {
    ensureBusyOverlay();
    const el = document.getElementById('app-busy');
    const txt = document.getElementById('busy-text');
    if (txt) txt.textContent = message || 'Veuillez patienter…';
    if (el) el.style.display = on ? 'flex' : 'none';
  }
  function setRowBusy(tr, on = true) {
    if (!tr) return;
    tr.classList.toggle('row-busy', !!on);
    const btns = tr.querySelectorAll('button, input');
    btns.forEach(b => (b.disabled = !!on));
    if (on) {
      const cell = tr.querySelector('td.actions');
      if (cell && !cell.querySelector('.mini-spinner')) {
        const s = document.createElement('span');
        s.className = 'mini-spinner';
        s.title = 'Envoi…';
        cell.prepend(s);
      }
    } else {
      tr.querySelectorAll('.mini-spinner').forEach(n => n.remove());
    }
  }

  /* ================== Utils config/modules ================== */
  async function getConfig() {
    try { return await (window.electronAPI?.getConfig?.()); } catch { return {}; }
  }
  async function getModules() {
    try { return await (window.getMods?.() || window.electronAPI.getModules()); } catch { return {}; }
  }

  /* ================== Constantes & helpers domaine ================== */
  const INV_SESSION_KEY = 'inventory_session_id';
  const DRAFT_KEY       = 'inventaire_draft_v1';

  const normalize = (s) =>
    (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const singularizeWord = (w) => (w.length >= 4 && (w.endsWith("s") || w.endsWith("x"))) ? w.slice(0, -1) : w;
  const singularizeStr  = (s) => normalize(s).split(/\s+/).map(singularizeWord).join(" ");
  function byName(a, b) { const an = normalize(a.nom), bn = normalize(b.nom); return an < bn ? -1 : an > bn ? 1 : 0; }

  function getBarcode(p){ return (p?.code_barres ?? p?.code_barre ?? p?.barcode ?? p?.code ?? p?.ean ?? "").toString(); }
  function getUnitName(p, unitesById={}){ return p.unite_nom || unitesById[p.unite_id]?.nom || ""; }
  function isDecimalUnit(unit){ const u=(unit||"").toLowerCase(); return /\b(kg|kilo|kilogram|g|gram|l|litre|liter|ml|cl)\b/.test(u); }
  function parseLocaleNumber(v){ if(v===""||v===null||typeof v==="undefined") return null; return Number(String(v).replace(",", ".")); }

  async function fetchProduits(){ if(window.electronAPI?.getProduits) return await window.electronAPI.getProduits(); if(window.electronAPI?.produits?.list) return await window.electronAPI.produits.list(); throw new Error("Aucune méthode pour récupérer les produits."); }
  async function fetchFournisseurs(){ if(!window.electronAPI?.getFournisseurs) return []; try{ return await window.electronAPI.getFournisseurs(); } catch{ return []; } }
  async function fetchCategoriesProduits(){ if(!window.electronAPI?.getCategoriesProduits) return []; try{ return await window.electronAPI.getCategoriesProduits(); } catch{ return []; } }
  async function fetchUnites(){ if(!window.electronAPI?.getUnites) return []; try{ return await window.electronAPI.getUnites(); } catch{ return []; } }

  function filterList(list, qRaw, fournisseursById = {}) {
    const q = (qRaw || "").trim();
    if (!q) return list;
    const tokens = normalize(q).split(/\s+/).filter(Boolean).map(singularizeWord);
    return list.filter((p) => {
      const nameNorm = normalize(p.nom), nameSing = singularizeStr(p.nom);
      const fournisseurNom = p.fournisseur_nom || (fournisseursById[p.fournisseur_id]?.nom || "");
      const fournNorm = normalize(fournisseurNom), fournSing = singularizeStr(fournisseurNom);
      const haystack = `${nameNorm} ${nameSing} ${fournNorm} ${fournSing}`;
      const code = getBarcode(p);
      return tokens.every((t) => /\d/.test(t) ? code.includes(t) : haystack.includes(t));
    });
  }

  /* ================== UI: une ligne produit ================== */
  function rowHTML(p, st, fournisseursById, unitesById) {
    const draft = st.draft ?? (st.counted ?? "");
    const validated = !!st.validated;

    let deltaCell = "";
    let rowCls = "";
    if (validated) {
      const effectiveCount = (Number(st.remoteCount) > 0) ? Number(st.remoteCount) : Number(st.counted ?? 0);
      const delta = effectiveCount - Number(st.system);
      deltaCell = `${delta > 0 ? "+" : ""}${delta}`;
      rowCls = delta === 0 ? "validated delta0" : (delta > 0 ? "validated pos" : "validated neg");
    } else {
      if (Number(st.remoteCount) > 0) deltaCell = `<span class="live-badge" title="Total compté (tous postes)">∑ ${Number(st.remoteCount)}</span>`;
    }

    const prixVal = (typeof p.prix === "number" ? p.prix : Number(p.prix || 0));
    const prixStr = Number.isFinite(prixVal) ? prixVal.toFixed(2) : "";
    const fournisseurNom = fournisseursById[p.fournisseur_id]?.nom || p.fournisseur_nom || "";
    const catEff = p.categorie_produit_nom || fournisseursById[p.fournisseur_id]?.categorie_nom || "";
    const unitName = getUnitName(p, unitesById);
    const code = getBarcode(p);

    return `
      <tr data-id="${p.id}" class="${rowCls}">
        <td class="prod">${p.nom}</td>
        <td class="fourn">${fournisseurNom}</td>
        <td class="cat">${catEff}</td>
        <td class="unit">${unitName}</td>
        <td class="code">${code}</td>
        <td class="sys">${st.system}</td>
        <td class="cnt">
          <input type="text" inputmode="decimal" value="${draft === null ? "" : draft}" class="counted" placeholder="${isDecimalUnit(unitName) ? 'ex: 1,25' : 'ex: 3'}" />
        </td>
        <td class="dlt">${deltaCell}</td>
        <td class="price">${prixStr}</td>
        <td class="actions">
          <button class="row-validate">Valider</button>
          <button class="row-edit">Éditer</button>
          <button class="row-delete">Supprimer</button>
        </td>
      </tr>
    `;
  }

  /* ================== Page Inventaire ================== */
  window.PageInventaire = (() => {
    function debounce(fn, wait = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }

    // session locale (explicite)
    const SESSION_KEY = INV_SESSION_KEY;
    const getSessionId = () => { try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; } };
    const setSessionId = (id) => { try { id ? localStorage.setItem(SESSION_KEY, String(id)) : localStorage.removeItem(SESSION_KEY); } catch {} };
    const purgeLocalSessionAndDraft = () => {
      try { localStorage.removeItem(SESSION_KEY); } catch {}
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    };

    // helpers message barre
    function useStatusBar() {
      const statusBar = document.createElement('div');
      statusBar.id = 'inv-status';
      statusBar.style.cssText = 'display:none;margin:8px 0;padding:8px;border-radius:8px;font-size:.92rem;';
      const show = (msg, kind = 'warn') => {
        statusBar.style.display = 'block';
        statusBar.textContent = msg;
        statusBar.style.background = kind === 'ok' ? '#e6fff2' : '#fff4e6';
        statusBar.style.border = '1px solid ' + (kind === 'ok' ? '#b7f0cf' : '#ffd9b3');
        statusBar.style.color = kind === 'ok' ? '#145a32' : '#7a3e00';
      };
      const hide = () => { statusBar.style.display = 'none'; };
      return { el: statusBar, show, hide };
    }

    async function renderInventaire() {
      const mount = document.getElementById("page-content");
      const [produits, fournisseurs, categories, unites] = await Promise.all([
        fetchProduits(), fetchFournisseurs(), fetchCategoriesProduits(), fetchUnites()
      ]);

      const cfg = await getConfig().catch(() => ({}));
      const pollEverySec = Number(cfg?.inventory?.poll_interval_sec || 5);
      const emailTo = cfg?.inventory?.email_to || null;
      const currentUser = 'Inventaire';

      // ---- status bar
      const status = useStatusBar();
      mount.before(status.el);

      // ---- état
      const fournisseursById = Object.fromEntries((fournisseurs || []).map(f => [f.id, f]));
      const unitesById = Object.fromEntries((unites || []).map(u => [u.id, u]));

      const state = new Map();
      for (const p of produits) {
        state.set(p.id, { system: Number(p.stock || 0), counted: null, validated: false, draft: null, prevSent: 0, remoteCount: 0 });
      }

      // ---- layout
      mount.innerHTML = `
        <div class="inv-toolbar">
          <input id="inv-search" placeholder="Rechercher (nom / fournisseur / code-barres)..." />
          <div class="spacer"></div>
          <button id="btnStartSession">Commencer une session</button>
          <button id="inv-apply" disabled>Clôturer l’inventaire</button>
          <button id="btnForceClose">Forcer la fermeture des sessions</button>

        </div>

        <div id="inv-scroll" class="inv-scroll">
          <table class="inv-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Fournisseur</th>
                <th>Catégorie</th>
                <th>Unité</th>
                <th>Code</th>
                <th>Stock</th>
                <th>Compté</th>
                <th>Écart</th>
                <th>Prix</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="inv-rows"></tbody>
          </table>
        </div>

        <style>
          .inv-toolbar{ background:#fff; display:flex; gap:.5rem; align-items:center; padding:.5rem 0; border-bottom:1px solid #eee; }
          .inv-toolbar .spacer { flex: 1; }
          .inv-scroll{ max-height: calc(100vh - 140px); overflow: auto; }
          .inv-table{ width:100%; border-collapse:collapse }
          .inv-table th,.inv-table td{ border:1px solid #ddd; padding:.45rem }
          .inv-table thead th { background:#fafafa; position: sticky; top: 0; z-index: 1; }
          td.actions { white-space: nowrap; }
          td.actions button { padding:.25rem .5rem; margin-left:.25rem; }
          .counted { width: 9ch; }
          tr.validated { background:#f5fbff; }
          .pos { color:#0a7a0a; font-weight:600; }
          .neg { color:#b00020; font-weight:600; }
          .delta0 { opacity:.7; }
          #app-busy { display:none; position:fixed; inset:0; z-index:99999; align-items:center; justify-content:center; }
          #app-busy .busy-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.35); backdrop-filter: blur(1px); }
          #app-busy .busy-panel { position:relative; background:#fff; padding:16px 18px; border-radius:10px; min-width:280px; display:flex; gap:12px; align-items:center; box-shadow:0 10px 30px rgba(0,0,0,.25); }
          .busy-spinner, .mini-spinner { width:16px; height:16px; border-radius:50%; border:2px solid rgba(0,0,0,.15); border-top-color:#444; animation:spin 0.9s linear infinite; display:inline-block; vertical-align:middle; }
          .busy-spinner { width:18px; height:18px; }
          @keyframes spin { to { transform: rotate(360deg);} }
          tr.row-busy { opacity:.6; }
          .disabled { opacity: .6; pointer-events: none; }
        </style>
      `;

      const $rows   = mount.querySelector("#inv-rows");
      const $search = mount.querySelector("#inv-search");
      const $scroll = mount.querySelector("#inv-scroll");
      const $apply  = mount.querySelector("#inv-apply");
      const $btnStart = mount.querySelector("#btnStartSession");

      const $btnForceClose = mount.querySelector('#btnForceClose');
$btnForceClose.addEventListener('click', async () => {
  if (!confirm('Fermer TOUTES les sessions d’inventaire distantes ouvertes ?')) return;
  try {
    await window.electronAPI.inventory.closeAllOpen();
    localStorage.removeItem('inventory_session_id');
    localStorage.removeItem('inventaire_draft_v1');
    alert('Toutes les sessions ouvertes ont été fermées côté serveur.');
    location.reload();
  } catch (e) {
    alert('Échec fermeture sessions: ' + (e?.message || e));
  }
});


      // ---- draft persistance
      const saveDraft = () => {
        try {
          const items = [];
          for (const [id, st] of state.entries()) { items.push({ id, counted: st.counted, validated: !!st.validated, draft: st.draft ?? null }); }
          const data = { at: Date.now(), search: $search?.value || "", items };
          localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        } catch {}
      };
      const saveDraftDebounced = debounce(saveDraft, 250);

      function loadDraft() {
        try {
          const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return;
          const data = JSON.parse(raw); if (!data?.items) return;
          if ($search && typeof data.search === 'string') $search.value = data.search;
          for (const it of data.items) {
            const st = state.get(it.id); if (!st) continue;
            st.counted   = (it.counted === null || typeof it.counted === 'undefined') ? null : Number(it.counted);
            st.validated = !!it.validated;
            st.draft     = (typeof it.draft === 'string') ? it.draft : (st.counted !== null ? String(st.counted) : null);
            state.set(it.id, st);
          }
        } catch {}
      }

      // ---- rendu lignes
      function renderRows() {
        const q = $search.value || "";
        const filtered = filterList(produits, q, fournisseursById);
        const prevTop = $scroll.scrollTop;
        filtered.sort(byName);
        const html = filtered.length ? filtered.map((p) => rowHTML(p, state.get(p.id), fournisseursById, unitesById)).join("")
                                     : `<tr><td colspan="10"><em>Aucun produit</em></td></tr>`;
        $rows.innerHTML = html;
        $scroll.scrollTop = prevTop;
      }

      loadDraft();
      renderRows();

      function disableInventoryInputs(disabled) {
        if (disabled) { mount.classList.add('disabled'); } else { mount.classList.remove('disabled'); }
      }

      // ---- session explicite : pas d’auto-reprise ni d’auto-start
      async function resumeIfWanted() {
        const sid = getSessionId();
        if (!sid) {
          status.show('Aucune session active. Cliquez sur “Commencer une session”.', 'warn');
          $apply.disabled = true;
          return;
        }
        try {
          const sum = await (window.electronAPI.invoke
            ? window.electronAPI.invoke('inventory:getSummary', sid)
            : window.electronAPI.inventory.getSummary(sid));
          const statusStr = (sum?.session?.status || sum?.status || '').toString().toLowerCase();
          if (statusStr && statusStr !== 'open') {
            purgeLocalSessionAndDraft();
            status.show('La session distante est clôturée. Cliquez sur “Commencer une session”.', 'ok');
            $apply.disabled = true;
            return;
          }
          status.show('Session en cours détectée. Vous pouvez reprendre ou clôturer.', 'ok');
          $apply.disabled = false;
        } catch {
          purgeLocalSessionAndDraft();
          status.show('La session locale n’existe plus côté serveur. Cliquez sur “Commencer une session”.', 'warn');
          $apply.disabled = true;
        }
      }

      async function startSession() {
        try {
          setBusy(true, 'Création de la session…');
          const name = `Inventaire ${new Date().toISOString().slice(0,10)}`;
          const js = await window.electronAPI.inventory.start({ name, user: currentUser, notes: null });
          const sid = String(js?.session?.id || js?.id || '').trim();
          if (!sid) throw new Error('id de session manquant');
          setSessionId(sid);
          status.show('Session d’inventaire démarrée. Vous pouvez compter et clôturer.', 'ok');
          $apply.disabled = false;
        } catch (e) {
          alert('Impossible de démarrer une session : ' + (e?.message || e));
        } finally {
          setBusy(false);
        }
      }

      // ---- actions UI session
      $btnStart.addEventListener('click', async () => {
        setSessionId(null); // purge toute ancienne session locale
        purgeLocalSessionAndDraft();
        await startSession();
      });

      await resumeIfWanted();

      // ---- recherche
      $search.addEventListener("input", () => { renderRows(); saveDraftDebounced(); });

      // ---- scan / entrée directe sur input de recherche
      $search.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const code = ($search.value || "").trim(); if (!code) return;
        const exact = produits.find((p) => getBarcode(p) === code);
        if (exact) {
          const st = state.get(exact.id);
          const base = (st.draft !== null && st.draft !== undefined && st.draft !== "")
            ? parseLocaleNumber(st.draft) ?? Number(st.system || 0)
            : (st.counted !== null ? Number(st.counted) : Number(st.system || 0));
          const next = (Number.isFinite(base) ? base : Number(st.system || 0)) + 1;
          st.draft = String(next);
          state.set(exact.id, st);
          renderRows();
          saveDraftDebounced();

          const sid = getSessionId();
          if (sid) {
            $search.disabled = true;
            try {
              await window.electronAPI.inventory.countAdd({ sessionId: sid, product_id: exact.id, qty: 1, user: currentUser });
              const st2 = state.get(exact.id);
              st2.prevSent = Number(st2.prevSent || 0) + 1;
              state.set(exact.id, st2);
            } catch (err) {
              const msg = (err?.message || '') + ' ' + (err?.stack || '');
              if (String(msg).includes('session_locked')) {
                status.show('Session verrouillée/close côté serveur. On purge la session locale.', 'warn');
                purgeLocalSessionAndDraft();
                disableInventoryInputs(true);
                $apply.disabled = true;
              } else if (/401/.test(msg) || /Missing token/i.test(msg)) {
                try {
                  if (window.electronAPI?.ensureAuth) {
                    await window.electronAPI.ensureAuth();
                    await window.electronAPI.inventory.countAdd({ sessionId: sid, product_id: exact.id, qty: 1, user: currentUser });
                    const st2b = state.get(exact.id);
                    st2b.prevSent = Number(st2b.prevSent || 0) + 1;
                    state.set(exact.id, st2b);
                    status.hide?.();
                  }
                } catch { status.show('Auth expirée pendant le comptage. Saisie locale OK, mais non synchronisée.', 'warn'); }
              } else {
                status.show('Erreur inventaire : ' + msg, 'warn');
              }
            } finally { $search.disabled = false; $search.focus(); $search.select(); }
          } else {
            status.show('Pas de session active : la saisie reste locale. Cliquez sur “Commencer une session”.', 'warn');
          }
        }
      });

      // ---- validateRow (avec gestion session/409)
      function validateRow(id) {
        const tr = $rows.querySelector(`tr[data-id="${id}"]`);
        const st = state.get(id); if (!st) return;
        setRowBusy(tr, true);

        let raw = (typeof st.draft === 'string') ? st.draft : null;
        if (raw === null) { const input = tr?.querySelector(`input.counted`); raw = input ? input.value : ""; }
        raw = String(raw).trim();

        const p = produits.find(x => x.id === id);
        const unitName = getUnitName(p, unitesById);
        const allowDecimal = isDecimalUnit(unitName);
        const num = parseLocaleNumber(raw);
        if (raw !== "" && (num === null || !Number.isFinite(num))) { alert("Valeur invalide. Utilise un nombre (ex: 1,25)."); setRowBusy(tr, false); return; }
        if (!allowDecimal && num !== null && !Number.isInteger(num)) { alert(`Cette unité (“${unitName || 'unité'}”) demande un entier.`); setRowBusy(tr, false); return; }

        if (raw === "") st.counted = null; else st.counted = allowDecimal ? num : Math.trunc(num);
        st.validated = true;
        st.draft = (st.counted === null ? "" : String(st.counted));
        state.set(id, st);

        const sid = getSessionId();
        if (sid) {
          (async () => {
            try {
              const effective = (st.counted === null ? 0 : Number(st.counted));
              const deltaToSend = effective - Number(st.prevSent || 0);
              if (Number.isFinite(deltaToSend) && deltaToSend !== 0) {
                await window.electronAPI.inventory.countAdd({ sessionId: sid, product_id: id, qty: deltaToSend, user: currentUser });
                st.prevSent = effective;
                state.set(id, st);
              }
            } catch (err) {
              const msg = String(err?.message || err);
              if (msg.includes('session_locked')) {
                status.show('Cette session est verrouillée côté serveur. Démarrez une nouvelle session.', 'warn');
                disableInventoryInputs(true);
              } else {
                console.warn('[inventaire] count-add failed for product', id, msg);
              }
            } finally { setRowBusy(tr, false); }
          })();
        } else {
          setRowBusy(tr, false);
        }

        $search.value = "";
        renderRows();
        saveDraftDebounced();
      }

      // Auto-validation sur BLUR + Enter
      $rows.addEventListener("focusout", (e) => {
        const input = e.target.closest('input.counted');
        if (!input) return;
        const tr = input.closest("tr[data-id]");
        if (!tr) return;
        const id = Number(tr.dataset.id);
        const st = state.get(id);
        const raw = String(input.value || '').trim();
        if (!st.validated || raw !== (st.draft ?? '')) {
          st.draft = raw;
          state.set(id, st);
          validateRow(id);
        }
      });
      $rows.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        if (e.target.classList.contains("counted")) {
          e.preventDefault();
          validateRow(Number(tr.dataset.id));
        }
      });

      // actions sur lignes
      $rows.addEventListener("click", async (e) => {
        const tr = e.target.closest("tr[data-id]"); if (!tr) return;
        const id = Number(tr.dataset.id);

        if (e.target.closest(".row-validate")) { validateRow(id); return; }
        if (e.target.closest(".row-edit")) { await openEditModal(id); return; }
        if (e.target.closest(".row-delete")) { await deleteProduct(id); return; }
      });

      async function openEditModal(id) {
        const p = produits.find(x => x.id === id); if (!p) return;
        const res = await openProductEditor(p, { title: 'Éditer le produit', allowDelete: true });
        if (!res || res.action === 'cancel') return;
        if (res.action === 'save') {
          try {
            await window.electronAPI.modifierProduit(res.data);
            Object.assign(p, res.data);
            const st = state.get(id); if (st) st.system = Number(p.stock || 0);
            renderRows(); saveDraftDebounced();
          } catch (err) { alert('Erreur d’enregistrement : ' + (err?.message || err)); }
        }
        if (res.action === 'delete') await deleteProduct(id);
      }
      async function deleteProduct(id) {
        const p = produits.find(x => x.id === id); if (!p) return;
        if (!confirm(`Supprimer le produit "${p.nom}" ?`)) return;
        if (!confirm(`Confirmer la suppression DÉFINITIVE de "${p.nom}" ?`)) return;
        try {
          await window.electronAPI.supprimerProduit(id);
          const idx = produits.findIndex(x => x.id === id);
          if (idx >= 0) produits.splice(idx, 1);
          state.delete(id);
          renderRows(); saveDraftDebounced();
        } catch (err) { alert("Erreur de suppression : " + (err?.message || err)); }
      }

      // ---- rafraîchissement du summary distant (optionnel)
      async function refreshSummary() {
        const sid = getSessionId();
        if (!sid) return;
        try {
          const sum = await window.electronAPI.inventory.summary({ sessionId: sid });
          const byId = new Map();
          for (const r of (sum?.lines || [])) byId.set(Number(r.product_id), r);

          let changed = false;
          for (const p of produits) {
            const srow = byId.get(Number(p.id));
            const st = state.get(p.id);
            const prev = st.remoteCount;
            const next = Number(srow?.counted_total || 0);
            if (prev !== next) { st.remoteCount = next; state.set(p.id, st); changed = true; }
          }
          if (changed) renderRows();
        } catch {}
      }
      if (pollEverySec > 0) { refreshSummary(); setInterval(refreshSummary, pollEverySec * 1000); }

      if (window.electronEvents?.on) {
        window.electronEvents.on('inventory:session-changed', (_evt, payload) => {
          if (payload?.session?.status === 'closed') {
            purgeLocalSessionAndDraft();
            location.reload();
          }
        });
        window.electronEvents.on('inventory:session-closed', () => {
          purgeLocalSessionAndDraft();
          const status = document.getElementById('inv-status');
          if (status) status.textContent = 'Aucune session active. Cliquez sur “Commencer une session”.';
          $apply.disabled = true;
          disableInventoryInputs(false);
          $search.value = '';
          renderRows();
        });
        window.electronEvents.on('data:refreshed', () => { location.reload(); });
      }

      // ---- forcer la validation des lignes non validées avant finalize
      async function validateAllPending() {
        const ids = [];
        for (const [id, st] of state.entries()) {
          const raw = (typeof st.draft === 'string') ? st.draft.trim() : '';
          if (!st.validated && raw !== '') ids.push(id);
        }
        for (const id of ids) {
          await new Promise((resolve) => { validateRow(id); setTimeout(resolve, 50); });
        }
      }

      $apply.addEventListener("click", async () => {
        const sid = getSessionId();
        if (!sid) { alert("Aucune session active. Cliquez sur “Commencer une session”."); return; }

        await validateAllPending();

        const ok = confirm("Clôturer l’inventaire ?\nTous les produits non saisis seront remis à 0.");
        if (!ok) return;

        $apply.disabled = true;
        setBusy(true, 'Clôture de l’inventaire en cours…');

        // Récap local
        let countedProducts = 0;
        let inventoryValue = 0;
        try {
          for (const [id, st] of state.entries()) {
            if (st.validated && st.draft !== '') {
              countedProducts++;
              const p = produits.find(pp => pp.id === id);
              const qty = Number(st.counted ?? 0);
              const pu = Number(p?.prix || 0);
              inventoryValue += qty * pu;
            }
          }
        } catch {}

        try {
          const res = await window.electronAPI.inventory.finalize({ sessionId: sid, user: 'Inventaire', email_to: emailTo });

          try { await window.electronAPI.syncPullAll?.(); } catch {}

          purgeLocalSessionAndDraft();

          const end = new Date();
          const dateStr = end.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
          alert(
            "✅ Inventaire clôturé.\n\n" +
            `Date : ${dateStr}\n` +
            `Produits inventoriés : ${countedProducts}\n` +
            `Valeur du stock inventorié : ${Number(inventoryValue || 0).toFixed(2)} €`
          );

          try {
            const mods = await getModules();
            const emailsOn = !!(mods?.email || mods?.emails);
            if (emailsOn && emailTo) {
              const subject = `Inventaire clôturé — ${res?.recap?.session?.name || 'Session'}`;
              const text =
`Inventaire "${res?.recap?.session?.name || ''}" clôturé le ${dateStr}.

Produits inventoriés : ${countedProducts}
Valeur du stock inventorié : ${Number(inventoryValue || 0).toFixed(2)} €.

Session #${res?.recap?.session?.id || ''}`;
              await window.electronAPI.sendInventoryRecapEmail?.({ to: emailTo, subject, text });
            }
          } catch {}

          location.reload();

        } catch (e) {
          const msg = String(e?.message || e);
          if (msg.includes('session_locked')) {
            alert('La session est verrouillée côté serveur. Elle est sans doute déjà clôturée.');
            purgeLocalSessionAndDraft();
            location.reload();
          } else {
            alert('Erreur de clôture : ' + msg);
          }
        } finally {
          setBusy(false);
          $apply.disabled = false;
        }
      });
    }

    return { renderInventaire };
  })();
})();
