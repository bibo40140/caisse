// src/renderer/pages/parametres/mon-compte/categories.js
(() => {
  async function render() {
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
        .btn.btn-ghost { background:transparent; border:none; }
      `;
      document.head.appendChild(st);
    }

    function paint() {
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

    paint();

    el.addEventListener('click', async (e) => {
      const t = e.target;

      if (t.id === 'add-fam') {
        const nom = (el.querySelector('#new-fam-name')?.value || '').trim();
        if (!nom) return;
        await createFamily(nom);
        familles   = await getFamilies();
        categories = await getCategories();
        el.querySelector('#new-fam-name').value = '';
        paint();
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
        paint();
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
        paint();
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
        paint();
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
        paint();
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
          paint();
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
        paint();
        const pane = el.querySelector(`details[data-fam-id="${famId}"]`);
        if (pane) pane.open = true;
      }
    });
  }

  window.PageParamsCategories = { render };
})();
