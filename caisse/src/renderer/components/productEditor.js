// src/renderer/components/productEditor.js
// Popup d'édition produit réutilisable, exposée globalement : window.ProductEditor.openProductEditor

(function () {
  function escapeHtml(s){ return (s??'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
  function injectOnce(css, id){
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function openProductEditor(initialProduct = {}, opts = {}) {
    const {
      fournisseurs = null,
      // on tente d’avoir la version “détaillée” (avec famille), sinon fallback
      categories   = null,
      unites       = null,
      title        = 'Éditer le produit',
      allowDelete  = true,
    } = opts;

    // ---------- Chargements ----------
    const [fList, rawCats, uList, modules] = await Promise.all([
      fournisseurs ?? (window.electronAPI?.getFournisseurs?.() || Promise.resolve([])),
      (async () => {
        if (categories) return categories;
        // essaie d'abord la version détaillée (id, nom, famille_id, famille_nom)
        if (window.electronAPI?.getAllCategoriesDetailed) {
          return await window.electronAPI.getAllCategoriesDetailed();
        }
        if (window.electronAPI?.getCategories) {
          const simple = await window.electronAPI.getCategories(); // {id, nom, famille_id?}
          // Normalise en ajoutant un fam par défaut
          return (simple||[]).map(c => ({...c, famille_nom: c.famille_nom || 'Autres'}));
        }
        return [];
      })(),
      unites ?? (window.electronAPI?.getUnites?.() || Promise.resolve([])),
      (window.getMods?.() || window.electronAPI?.getModules?.() || Promise.resolve({})),
    ]);

    const showFournisseurs = !!modules?.fournisseurs;

    // ---------- Normalisation du produit ----------
    const p = {
      id:              initialProduct.id ?? null,
      reference:       initialProduct.reference ?? '',
      nom:             initialProduct.nom ?? '',
      fournisseur_id:  (initialProduct.fournisseur_id ?? '') || '',
      categorie_id:    initialProduct.categorie_id ?? initialProduct.categorie_produit_id ?? null,
      prix:            Number(initialProduct.prix ?? 0),
      stock:           Number(initialProduct.stock ?? 0),
      code_barre:      initialProduct.code_barre ?? initialProduct.code_barre ?? '',
      unite_id:        initialProduct.unite_id ?? null,
      // au cas où seul le libellé d’unité est présent
      unite:           initialProduct.unite ?? null,
      fournisseur_categorie_id: initialProduct.fournisseur_categorie_id ?? null,
    };

    // Si pas d’unite_id mais un libellé, on mappe
    if (!p.unite_id && p.unite) {
      const m = (uList||[]).find(u => String(u.nom).toLowerCase() === String(p.unite).toLowerCase());
      if (m) p.unite_id = m.id;
    }

    // Si pas de categorie_id → essayer celle du fournisseur
    if (!p.categorie_id && (p.fournisseur_categorie_id || p.fournisseur_id)) {
      let fidCat = p.fournisseur_categorie_id;
      if (!fidCat && p.fournisseur_id) {
        const f = (fList||[]).find(x => String(x.id) === String(p.fournisseur_id));
        fidCat = f?.categorie_id ?? null;
      }
      if (fidCat) p.categorie_id = fidCat;
    }

    // ---------- Catégories groupées par famille ----------
    const cats = (rawCats || []).map(c => ({
      id: c.id,
      nom: c.nom,
      famille_id: c.famille_id ?? null,
      famille_nom: c.famille_nom || 'Autres'
    }));
    const catsByFam = new Map();
    cats.forEach(c => {
      const key = c.famille_nom || 'Autres';
      if (!catsByFam.has(key)) catsByFam.set(key, []);
      catsByFam.get(key).push(c);
    });
    // tri alphabétique par famille puis par nom de catégorie
    const orderedFamilies = Array.from(catsByFam.keys()).sort((a, b) => a.localeCompare(b, 'fr'));
    orderedFamilies.forEach(fam => catsByFam.get(fam).sort((a,b) => a.nom.localeCompare(b.nom,'fr')));

    // ---------- HTML ----------
    injectOnce(`
      .modal-backdrop.pe{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99999}
      .modal.pe{background:#fff; border-radius:12px; box-shadow:0 12px 36px rgba(0,0,0,.25); padding:16px; width:min(680px, 96vw)}
      .pe h3 { margin:0 0 12px 0; }
      .pe-row { display:grid; grid-template-columns:180px 1fr; gap:8px; margin-bottom:10px; align-items:center; }
      .pe-footer { margin-top:14px; display:flex; gap:8px; justify-content:flex-end; }
      .pe-footer .danger { background:#b00020; color:#fff; }
      .modal.pe input, .modal.pe select { width:100%; padding:7px 8px; }
      .pe small { color:#666; }
    `, 'pe-style');

    const bd = document.createElement('div');
    bd.className = 'modal-backdrop pe';
    bd.innerHTML = `
      <div class="modal pe">
        <h3>${escapeHtml(title)}</h3>

        <div class="row pe-row">
          <label>Nom</label>
          <input id="pe-nom" value="${escapeAttr(p.nom)}" />
        </div>

        <div class="row pe-row">
          <label>Référence</label>
          <input id="pe-ref" value="${escapeAttr(p.reference || '')}" placeholder="auto si vide">
        </div>

        ${showFournisseurs ? `
        <div class="row pe-row">
          <label>Fournisseur</label>
          <select id="pe-fourn">
            <option value="">—</option>
            ${(fList || []).map(f => `
              <option value="${f.id}" ${String(f.id)===String(p.fournisseur_id)?'selected':''}>${escapeHtml(f.nom)}</option>
            `).join('')}
          </select>
        </div>
        ` : ''}

        <div class="row pe-row">
          <label>Catégorie</label>
          <select id="pe-cat">
            <option value="">—</option>
            ${orderedFamilies.map(fam => `
              <optgroup label="${escapeAttr(fam)}">
                ${catsByFam.get(fam).map(c => `
                  <option value="${c.id}" ${String(c.id)===String(p.categorie_id)?'selected':''}>${escapeHtml(c.nom)}</option>
                `).join('')}
              </optgroup>
            `).join('')}
          </select>
          <small>Groupées par famille</small>
        </div>

        <div class="row pe-row">
          <label>Unité</label>
          <select id="pe-unite">
            <option value="">—</option>
            ${(uList || []).map(u => `
              <option value="${u.id}" ${String(u.id)===String(p.unite_id)?'selected':''}>${escapeHtml(u.nom)}</option>
            `).join('')}
          </select>
        </div>

        <div class="row pe-row">
          <label>Prix</label>
          <input id="pe-prix" type="number" step="0.01" min="0" value="${Number(p.prix||0)}" />
        </div>

        <div class="row pe-row">
          <label>Stock</label>
          <input id="pe-stock" type="number" step="0.01" min="0" value="${Number(p.stock||0)}" />
        </div>

        <div class="row pe-row">
          <label>Code-barres</label>
          <input id="pe-code" value="${escapeAttr(p.code_barre||'')}" />
        </div>

        <div class="pe-footer">
          ${allowDelete ? `<button class="pe-delete danger">🗑️ Supprimer</button>` : ``}
          <button class="pe-cancel">Annuler</button>
          <button class="pe-save">💾 Enregistrer</button>
        </div>
      </div>
    `;
    document.body.appendChild(bd);

    const $ = (sel) => bd.querySelector(sel);

    // ====== 🔒 Verrouillage décimal si unité = "pièce" ======
    const normalize = (s) => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const isPieceUnit = (labelOrValue) => /(^|\\b)piece(s)?\\b/.test(normalize(labelOrValue)); // "pièce", "piece", "pieces"

    const selUnite  = $('#pe-unite');
    const stockInput = $('#pe-stock');

    function applyDecimalLockForUnit() {
      if (!selUnite || !stockInput) return;
      const unitText = selUnite.selectedOptions?.[0]?.textContent || '';
      const unitVal  = selUnite.value || '';
      const piece = isPieceUnit(unitText || unitVal);

      if (piece) {
        stockInput.step = '1';
        stockInput.min  = '0';

        // bloque saisie de décimales
        const blockDecimals = (e) => {
          if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
        };
        stockInput.onkeydown = blockDecimals;
        stockInput.oninput = (e) => {
          e.target.value = e.target.value.replace(/[^\d]/g,'');
        };

        // arrondit si une valeur décimale traîne
        const v = parseFloat(String(stockInput.value).replace(',', '.'));
        if (Number.isFinite(v)) stockInput.value = String(Math.max(0, Math.floor(v)));
      } else {
        stockInput.step = '0.01';
        stockInput.min  = '0';
        stockInput.onkeydown = null;
        stockInput.oninput   = null;
      }
    }

    // Appliquer d’emblée + sur changement d’unité
    applyDecimalLockForUnit();
    selUnite?.addEventListener('change', applyDecimalLockForUnit);
    // ====== fin verrouillage décimal ======

    function readForm() {
      const nom   = $('#pe-nom').value.trim();
      const reference = $('#pe-ref').value.trim();
      const fournEl = $('#pe-fourn');
      const fid   = fournEl ? (fournEl.value ? Number(fournEl.value) : null) : null;
      const cid   = $('#pe-cat').value ? Number($('#pe-cat').value) : null;
      const uid   = $('#pe-unite').value ? Number($('#pe-unite').value) : null;
      let prix    = Number(String($('#pe-prix').value).replace(',', '.'));
      let stock   = Number(String($('#pe-stock').value).replace(',', '.'));
      const code  = $('#pe-code').value.trim();

      // Garde-fou : si unité = pièce → stock entier
      const unitText = $('#pe-unite').selectedOptions?.[0]?.textContent || '';
      if (isPieceUnit(unitText || $('#pe-unite').value)) {
        if (Number.isFinite(stock)) stock = Math.max(0, Math.floor(stock));
      }

      return {
        id: p.id,
        reference: reference || null,
        nom,
        fournisseur_id: fid,
        categorie_id: cid,
        unite_id: uid,
        prix,
        stock,
        code_barre: code || null
      };
    }

    function validateForm(data) {
      if (!data.nom) return 'Nom requis';
      if (!Number.isFinite(data.prix) || data.prix < 0) return 'Prix invalide';
      if (!Number.isFinite(data.stock) || data.stock < 0) return 'Stock invalide';
      return null;
    }

    let resolveOnce = () => {};
    const resultPromise = new Promise((resolve) => { resolveOnce = resolve; });

    function close(result) {
      bd.remove();
      resolveOnce(result);
    }

    function onEsc(e){ if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); close({ action:'cancel' }); } }

    bd.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('pe-cancel')) close({ action:'cancel' });
    });

    $('.pe-save').addEventListener('click', async () => {
      const data = readForm();
      const err = validateForm(data);
      if (err) { alert(err); return; }
      close({ action:'save', data });
    });

    if ($('.pe-delete')) {
      $('.pe-delete').addEventListener('click', async () => {
        if (!confirm('Supprimer ce produit ?')) return;
        if (!confirm('Confirmer la suppression DÉFINITIVE ?')) return;
        close({ action:'delete', data: { id: p.id } });
      });
    }

    document.addEventListener('keydown', onEsc);
    setTimeout(() => $('#pe-nom')?.focus(), 0);

    return resultPromise;
  }

  window.ProductEditor = { openProductEditor };
})();
