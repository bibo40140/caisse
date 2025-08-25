// src/renderer/pages/inventaire.js
// Inventaire "solo-poste" :
// - Colonnes : Nom, Fournisseur, Catégorie (effective), Unité, Code-barres, Stock, Compté, Écart, Prix, Actions
// - Recherche unique (nom / fournisseur / code-barres) façon "caisse": accents ignorés, fragments, pluriels s/x, ordre libre
// - ⏸️ Aucune action pendant la saisie : on n'update ni delta ni styles tant que la ligne n'est pas validée (bouton ou Entrée)
// - Édition complète du produit (modale Produits), suppression (double confirmation)
// - Validation globale : applique deltas des VALIDÉS, met à 0 les NON VALIDÉS
// - 💾 Brouillon auto (localStorage) : counted validés + saisies en cours (draft) + recherche
// - 🔝 Barre de recherche fixe, liste scrollable avec en-tête collant + conservation du scroll

(function () {
  const openProductEditor = (...args) => window.ProductEditor.openProductEditor(...args);

  async function renderFormulaireProduit() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div id="produits-liste"></div>`;
    await chargerProduits();
  }

  window.PageInventaire = (() => {
    // ----- utils recherche façon "caisse"
    const normalize = (s) =>
      (s || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const singularizeWord = (w) => {
      if (w.length >= 4 && (w.endsWith("s") || w.endsWith("x"))) return w.slice(0, -1);
      return w;
    };

    const singularizeStr = (s) => normalize(s).split(/\s+/).map(singularizeWord).join(" ");

    function byName(a, b) {
      const an = normalize(a.nom);
      const bn = normalize(b.nom);
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }

    // --- Draft (brouillon inventaire) ---
    const DRAFT_KEY = 'inventaire_draft_v1';
    function debounce(fn, wait = 300) {
      let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    }

    // --- code-barres / unités / décimaux
    function getBarcode(p) {
      return (
        p?.code_barres ??
        p?.code_barre ??
        p?.barcode ??
        p?.code ??
        p?.ean ??
        ""
      ).toString();
    }

    function getUnitName(p, unitesById = {}) {
      // essaie dans l’objet produit, sinon via mapping unitesById
      return p.unite_nom || unitesById[p.unite_id]?.nom || "";
    }

    // unités pour lesquelles on veut autoriser les décimaux
    function isDecimalUnit(unitName) {
      const u = (unitName || "").toLowerCase();
      return /\b(kg|kilo|kilogram|g|gram|l|litre|liter|ml|cl)\b/.test(u);
    }

    // parse nombre avec virgule ou point
    function parseLocaleNumber(v) {
      if (v === "" || v === null || typeof v === "undefined") return null;
      return Number(String(v).replace(",", "."));
    }

    function effectiveCategory(p, fournisseursById) {
      // Catégorie effective = cat produit OU cat fournisseur (comme en caisse)
      return p.categorie_produit_nom || fournisseursById[p.fournisseur_id]?.categorie_nom || "";
    }

    // ----- fetchers (bridges existants)
    async function fetchProduits() {
      if (window.electronAPI?.getProduits) {
        return await window.electronAPI.getProduits();
      }
      if (window.electronAPI?.produits?.list) {
        return await window.electronAPI.produits.list();
      }
      throw new Error("Aucune méthode pour récupérer les produits.");
    }

    async function fetchFournisseurs() {
      if (!window.electronAPI?.getFournisseurs) return [];
      try { return await window.electronAPI.getFournisseurs(); } catch { return []; }
    }

    async function fetchCategoriesProduits() {
      if (!window.electronAPI?.getCategoriesProduits) return [];
      try { return await window.electronAPI.getCategoriesProduits(); } catch { return []; }
    }

    async function fetchUnites() {
      if (!window.electronAPI?.getUnites) return [];
      try { return await window.electronAPI.getUnites(); } catch { return []; }
    }

    function filterList(list, qRaw, fournisseursById = {}) {
      const q = (qRaw || "").trim();
      if (!q) return list;

      const tokens = normalize(q).split(/\s+/).filter(Boolean).map(singularizeWord);

      return list.filter((p) => {
        // nom produit (normalisé + "singularisé")
        const nameNorm = normalize(p.nom);
        const nameSing = singularizeStr(p.nom);

        // nom fournisseur (via champ direct ou mapping id → nom)
        const fournisseurNom =
          p.fournisseur_nom ||
          (fournisseursById[p.fournisseur_id]?.nom || "");
        const fournNorm = normalize(fournisseurNom);
        const fournSing = singularizeStr(fournisseurNom);

        // on concatène tout dans le "foin"
        const haystack = `${nameNorm} ${nameSing} ${fournNorm} ${fournSing}`;

        const code = getBarcode(p);

        // chaque token doit apparaître qq part : nom produit ou nom fournisseur,
        // et si le token contient des chiffres, on autorise match sur le code-barres
        return tokens.every((t) => {
          const hasDigit = /\d/.test(t);
          if (hasDigit && code.includes(t)) return true;
          return haystack.includes(t);
        });
      });
    }

    function rowHTML(p, st, fournisseursById, unitesById) {
      const draft = st.draft ?? (st.counted ?? ""); // texte saisi mais non validé
      const validated = !!st.validated;

      // delta visible uniquement si validé
      let deltaCell = "";
      let rowCls = "";
      if (validated) {
        const delta = Number(st.counted ?? 0) - Number(st.system);
        deltaCell = `${delta > 0 ? "+" : ""}${delta}`;
        rowCls = delta === 0 ? "validated delta0" : (delta > 0 ? "validated pos" : "validated neg");
      }

      const prixVal = (typeof p.prix === "number" ? p.prix : Number(p.prix || 0));
      const prixStr = Number.isFinite(prixVal) ? prixVal.toFixed(2) : "";

      const fournisseurNom = fournisseursById[p.fournisseur_id]?.nom || p.fournisseur_nom || "";
      const catEff = p.categorie_produit_nom || fournisseursById[p.fournisseur_id]?.categorie_nom || "";
      const unitName = getUnitName(p, unitesById);              // ← unité
      const code = getBarcode(p);

      // input texte pour autoriser 1,25 / 1.25, aucun traitement tant qu'on ne valide pas
      // on met inputmode=decimal pour clavier numérique sur mobile
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

    async function renderInventaire() {
      const mount = document.getElementById("page-content");
      const [produits, fournisseurs, categories, unites] = await Promise.all([
        fetchProduits(),
        fetchFournisseurs(),
        fetchCategoriesProduits(),
        fetchUnites(),
      ]);

      const fournisseursById = Object.fromEntries((fournisseurs || []).map(f => [f.id, f]));
      const unitesById = Object.fromEntries((unites || []).map(u => [u.id, u]));

      // État : { system:number, counted:number|null (validé), validated:boolean, draft:string|null (saisie en cours) }
      const state = new Map();
      for (const p of produits) {
        state.set(p.id, { system: Number(p.stock || 0), counted: null, validated: false, draft: null });
      }

      mount.innerHTML = `
        <div class="inv-toolbar">
          <input id="inv-search" placeholder="Rechercher (nom / fournisseur / code-barres)..." />
          <button id="inv-apply">Valider l’inventaire</button>
        </div>

        <!-- Conteneur scrollable -->
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
          /* Toolbar fixe au-dessus de la zone scrollable (pas besoin de sticky si seul le dessous scroll) */
          .inv-toolbar{
            background:#fff;
            display:flex;gap:.5rem;align-items:center;
            padding:.5rem 0;
            border-bottom:1px solid #eee;
          }

          /* Zone scrollable pour la liste */
          .inv-scroll{
            max-height: calc(100vh - 140px); /* ajuste si ta navbar/footers occupent plus d'espace */
            overflow: auto;
          }

          .inv-table{width:100%;border-collapse:collapse}
          .inv-table th,.inv-table td{border:1px solid #ddd;padding:.45rem}
          /* entête collant dans la zone scrollable */
          .inv-table thead th { background:#fafafa; position: sticky; top: 0; z-index: 1; }

          td.actions { white-space: nowrap; }
          td.actions button { padding:.25rem .5rem; margin-left:.25rem; }
          .counted { width: 9ch; }

          /* États visuels */
          tr.validated { background:#f5fbff; }    /* validé (bleu clair) */
          .pos { color:#0a7a0a; font-weight:600; }
          .neg { color:#b00020; font-weight:600; }
          .delta0 { opacity:.7; }

          /* Modale (style proche Produits) */
          .modal-backdrop {
            position: fixed; inset: 0; background: rgba(0,0,0,.35);
            display: flex; align-items: center; justify-content: center; z-index: 9999;
          }
          .modal {
            background: #fff; border-radius: 8px; padding: 16px; min-width: 520px; max-width: 92vw;
            box-shadow: 0 10px 30px rgba(0,0,0,.2);
          }
          .modal h3 { margin: 0 0 12px 0; }
          .modal .row { display: grid; grid-template-columns: 160px 1fr; gap: 8px; margin-bottom: 8px; align-items: center; }
          .modal footer { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
          .modal input, .modal select { width: 100%; padding: 6px 8px; }
          .modal .danger { background: #b00020; color: #fff; }
        </style>
      `;

      const $rows   = mount.querySelector("#inv-rows");
      const $search = mount.querySelector("#inv-search");
      const $scroll = mount.querySelector("#inv-scroll");

      // ---------- Draft helpers (définis ICI pour accéder à state/$search) ----------
      const saveDraft = () => {
        try {
          const items = [];
          for (const [id, st] of state.entries()) {
            items.push({ id, counted: st.counted, validated: !!st.validated, draft: st.draft ?? null });
          }
          const data = { at: Date.now(), search: $search?.value || "", items };
          localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        } catch {}
      };
      const saveDraftDebounced = debounce(saveDraft, 250);

      function loadDraft() {
        try {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (!raw) return;
          const data = JSON.parse(raw);
          if (!data?.items) return;

          if ($search && typeof data.search === 'string') $search.value = data.search;

          for (const it of data.items) {
            const st = state.get(it.id);
            if (!st) continue; // produit supprimé/absent
            st.counted   = (it.counted === null || typeof it.counted === 'undefined') ? null : Number(it.counted);
            st.validated = !!it.validated;
            st.draft     = (typeof it.draft === 'string') ? it.draft : (st.counted !== null ? String(st.counted) : null);
            state.set(it.id, st);
          }
        } catch {}
      }

      function clearDraft() {
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
      }
      // ------------------------------------------------------------------------------

      function renderRows() {
        const q = $search.value || "";
        const filtered = filterList(produits, q, fournisseursById);

        // mémorise la position de scroll actuelle
        const prevTop = $scroll.scrollTop;

        // tri alphabétique sur le nom
        filtered.sort(byName);

        // rendu simple, liste unique
        const html = filtered.length
          ? filtered.map((p) => rowHTML(p, state.get(p.id), fournisseursById, unitesById)).join("")
          : `<tr><td colspan="10"><em>Aucun produit</em></td></tr>`;

        $rows.innerHTML = html;

        // restaure la position de scroll
        $scroll.scrollTop = prevTop;
      }

      // Charger un éventuel brouillon puis premier rendu
      loadDraft();
      renderRows();

      // Recherche dynamique (+ sauvegarde de la recherche)
      $search.addEventListener("input", () => { renderRows(); saveDraftDebounced(); });

      // Entrée dans la recherche : si code-barres exact, +1 "draft" (sans valider) + sauvegarde
      $search.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const code = ($search.value || "").trim();
        if (!code) return;
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
        }
      });

      // Saisie "Compté" -> on met à jour UNIQUEMENT le draft, sans re-render global
      $rows.addEventListener("input", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        const id = Number(tr.dataset.id);
        if (e.target.classList.contains("counted")) {
          const st = state.get(id);
          st.draft = e.target.value; // texte libre (ex: "1,", "1.2", "1,25")
          state.set(id, st);
          // pas de renderRows ici → laisse l'utilisateur taper tranquillement
          saveDraftDebounced();
        }
      });

      // Entrée dans "Compté" => VALIDER la ligne
      $rows.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        if (e.target.classList.contains("counted")) {
          e.preventDefault();
          validateRow(Number(tr.dataset.id));
        }
      });

      // Clicks sur actions (Valider, Éditer, Supprimer)
      $rows.addEventListener("click", async (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        const id = Number(tr.dataset.id);

        if (e.target.closest(".row-validate")) {
          validateRow(id);
          return;
        }
        if (e.target.closest(".row-edit")) {
          await openEditModal(id);
          return;
        }
        if (e.target.closest(".row-delete")) {
          await deleteProduct(id);
          return;
        }
      });

      function validateRow(id) {
        const st = state.get(id);
        if (!st) return;

        // prendre la valeur "draft" si présente, sinon lire l'input du DOM
        let raw = (typeof st.draft === 'string') ? st.draft : null;
        if (raw === null) {
          const input = $rows.querySelector(`tr[data-id="${id}"] input.counted`);
          raw = input ? input.value : "";
        }
        raw = raw.trim();

        // contrôle selon unité
        const p = produits.find(x => x.id === id);
        const unitName = getUnitName(p, unitesById);
        const allowDecimal = isDecimalUnit(unitName);

        // parse
        const num = parseLocaleNumber(raw);
        if (raw !== "" && (num === null || !Number.isFinite(num))) {
          alert("Valeur invalide. Utilise un nombre (ex: 1,25).");
          return;
        }
        if (!allowDecimal && num !== null && !Number.isInteger(num)) {
          alert(`Cette unité (“${unitName || 'unité'}”) demande un entier.`);
          return;
        }

        // si champ vide → on considère "non saisi"
        if (raw === "") {
          st.counted = null;
        } else {
          st.counted = allowDecimal ? num : Math.trunc(num);
        }

        // passe en "validé"
        st.validated = true;
        // conserve une représentation texte cohérente dans le champ
        st.draft = (st.counted === null ? "" : String(st.counted));
        state.set(id, st);

        // UX : vider recherche, re-render, refocus + sauvegarde
        $search.value = "";
        renderRows();
        saveDraftDebounced();
        $search.focus();
      }

      async function openEditModal(id) {
        const p = produits.find(x => x.id === id);
        if (!p) return;

        const res = await openProductEditor(p, {
          title: 'Éditer le produit',
          allowDelete: true,
        });

        if (!res) return;
        if (res.action === 'cancel') return;

        if (res.action === 'save') {
          try {
            await window.electronAPI.modifierProduit(res.data);
            // maj cache + état
            Object.assign(p, res.data);
            const st = state.get(id);
            if (st) st.system = Number(p.stock || 0);
            renderRows();
            saveDraftDebounced();
          } catch (err) {
            alert('Erreur d’enregistrement : ' + (err?.message || err));
          }
        }

        if (res.action === 'delete') {
          try {
            await window.electronAPI.supprimerProduit(id);
            const idx = produits.findIndex(x => x.id === id);
            if (idx >= 0) produits.splice(idx, 1);
            state.delete(id);
            renderRows();
            saveDraftDebounced();
          } catch (err) {
            alert('Erreur de suppression : ' + (err?.message || err));
          }
        }
      }

      async function deleteProduct(id) {
        const p = produits.find(x => x.id === id);
        if (!p) return;

        if (!confirm(`Supprimer le produit "${p.nom}" ?`)) return;
        if (!confirm(`Confirmer la suppression DÉFINITIVE de "${p.nom}" ?`)) return;

        try {
          await window.electronAPI.supprimerProduit(id);
          // retire du cache produit + état
          const idx = produits.findIndex(x => x.id === id);
          if (idx >= 0) produits.splice(idx, 1);
          state.delete(id);
          renderRows();
          saveDraftDebounced();
        } catch (err) {
          alert("Erreur de suppression : " + (err?.message || err));
        }
      }

      // Validation GLOBALE :
      // - Applique les deltas des lignes VALIDÉES uniquement.
      // - Met à 0 (delta = -system) toutes les lignes NON VALIDÉES.
      mount.querySelector("#inv-apply").addEventListener("click", async () => {
        const lines = [];
        let nbValides = 0;
        let nbNonValides = 0;

        for (const p of produits) {
          const st = state.get(p.id);
          const system = Number(st.system || 0);

          if (st.validated) {
            const counted = (st.counted === null || st.counted === "") ? system : Number(st.counted);
            const delta = counted - system;
            if (delta !== 0) lines.push({ produit_id: p.id, delta });
            nbValides++;
          } else {
            // non validé -> mise à 0
            const delta = 0 - system;
            if (delta !== 0) lines.push({ produit_id: p.id, delta });
            nbNonValides++;
          }
        }

        if (!lines.length) {
          alert("Aucun ajustement à appliquer.");
          return;
        }

        const ok = confirm(
          `Valider l'inventaire ?\n` +
          `- Lignes VALIDÉES appliquées : ${nbValides}\n` +
          `- Lignes NON VALIDÉES (mises à 0) : ${nbNonValides}\n\n` +
          `Continuer ?`
        );
        if (!ok) return;

        try {
          const res = await window.electronAPI.ajusterStockBulk({ lines });
          if (!res || res.ok !== true) {
            alert("Erreur d’ajustement: " + (res?.error || "inconnue"));
            return;
          }
          alert(`Inventaire validé.\nAjustements appliqués : ${res.applied}`);

          // ✔ on efface le brouillon puisqu'on repart de zéro
          clearDraft();

          // Recharger les stocks et reset état
          const updated = await fetchProduits();
          for (const u of updated) {
            state.set(u.id, { system: Number(u.stock || 0), counted: null, validated: false, draft: null });
            const idx = produits.findIndex(x => x.id === u.id);
            if (idx !== -1) produits[idx] = u; // refresh cache produit (prix/stock/…)
          }
          $search.value = "";
          renderRows();
        } catch (e) {
          alert("Erreur: " + e.message);
        }
      });
    }

    return { renderInventaire };
  })();

})();
