// src/renderer/pages/produits.js
// Utilise la popup partagée via window.ProductEditor.openProductEditor

(function () {
  const openProductEditor = (...args) => window.ProductEditor.openProductEditor(...args);

  async function renderFormulaireProduit() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div id="produits-liste"></div>`;
    await chargerProduits();
  }

async function chargerProduits() {
  // On charge tout ce qu’il faut d’un coup
  const [liste, modules, fournisseurs, categories] = await Promise.all([
    window.electronAPI.getProduits(),
    (window.getMods?.() || window.electronAPI.getModules?.() || Promise.resolve({})),
    window.electronAPI.getFournisseurs(),
    // cat détaillées si dispo (avec famille), sinon simples
    (window.electronAPI.getAllCategoriesDetailed?.()
      ? window.electronAPI.getAllCategoriesDetailed()
      : window.electronAPI.getCategories())
  ]);
  const stocksOn = !!modules?.stocks;

  // Index utiles
  const catById = new Map((categories || []).map(c => [String(c.id), c]));
  const fournById = new Map((fournisseurs || []).map(f => [String(f.id), f]));

  // Calcule un label de catégorie “effective” (produit → sinon héritée du fournisseur)
  function catLabelFor(p) {
    // différents champs possibles selon ta couche main
    if (p.categorie_effective_nom) return p.categorie_effective_nom;
    if (p.categorie_produit_nom)   return p.categorie_produit_nom;
    if (p.categorie_nom)           return p.categorie_nom;

    // si on a directement l’ID de catégorie du produit
    if (p.categorie_id && catById.get(String(p.categorie_id))) {
      return catById.get(String(p.categorie_id)).nom;
    }

    // sinon on tente la catégorie du fournisseur
    const fidCat =
      p.fournisseur_categorie_id ??
      (fournById.get(String(p.fournisseur_id))?.categorie_id ?? null);

    if (fidCat && catById.get(String(fidCat))) {
      return catById.get(String(fidCat)).nom;
    }

    return '—';
  }

  const div = document.getElementById('produits-liste');
  if (!div) return;

  div.innerHTML = `
    <h3>Liste des produits</h3>
    <input type="text" id="filtre-produit" placeholder="🔍 Rechercher un produit..." style="width: 300px; padding: 5px;"><br><br>
    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Référence</th>
          <th>Prix</th>
          ${stocksOn ? '<th>Stock</th>' : ''}
          <th>Code-barre</th>
          <th>Unité</th>
          <th>Fournisseur</th>
          <th>Catégorie</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="table-produits-body">
        ${liste.map(p => {
          const catLabel = catLabelFor(p);
          return `
            <tr data-id="${p.id}">
              <td>${p.nom}</td>
              <td>${p.reference || '—'}</td>
              <td>${Number(p.prix || 0).toFixed(2)} €</td>
              ${stocksOn ? `<td>${p.stock ?? 0}</td>` : ``}
              <td>${p.code_barre || '—'}</td>
              <td>${p.unite || '—'}</td>
              <td>${p.fournisseur_nom || '—'}</td>
              <td>${catLabel}</td>
              <td>
                <button class="btn-edit-produit" data-id="${p.id}">✏️</button>
                <button class="btn-delete-produit" data-id="${p.id}">🗑️</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // --- Filtre ---
  const filtreInput = document.getElementById('filtre-produit');
  const lignes = Array.from(document.querySelectorAll('#table-produits-body tr'));
  const produitById = new Map(liste.map(p => [String(p.id), p]));

  lignes.forEach(tr => {
    const p = produitById.get(tr.dataset.id);
    const catLabel = catLabelFor(p);
    const index = [
      p?.nom, p?.reference, p?.code_barre, p?.unite,
      p?.fournisseur_nom, catLabel
    ].join(' ');
    tr.dataset.search = index.toLowerCase();
  });

  let _debounce;
  filtreInput.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      const toks = (filtreInput.value || '').toLowerCase().split(/\s+/).filter(Boolean);
      lignes.forEach(tr => {
        const hay = tr.dataset.search || (tr.textContent || '').toLowerCase();
        tr.style.display = toks.every(t => hay.includes(t)) ? '' : 'none';
      });
    }, 60);
  });

  // ====== Actions (inchangées) ======
  document.querySelectorAll('.btn-edit-produit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);

      // recharge le produit frais
      const produitsActuels = await window.electronAPI.getProduits();
      const produit = produitsActuels.find(p => p.id === id);
      if (!produit) return;

      const [fournisseurs, unites, categoriesDetailed] = await Promise.all([
        window.electronAPI.getFournisseurs(),
        window.electronAPI.getUnites(),
        (window.electronAPI.getAllCategoriesDetailed?.()
          ? window.electronAPI.getAllCategoriesDetailed()
          : window.electronAPI.getCategories()),
      ]);

      const res = await window.ProductEditor.openProductEditor(produit, {
        title: 'Éditer le produit',
        allowDelete: true,
        fournisseurs,
        categories: categoriesDetailed,
        unites,
      });
      if (!res || res.action === 'cancel') return;

      if (res.action === 'save') {
        const d = res.data || {};
        await window.electronAPI.modifierProduit({
          id: d.id,
          reference: d.reference,
          nom: d.nom,
          prix: d.prix,
          stock: d.stock,
          code_barre: d.code_barre,
          fournisseur_id: d.fournisseur_id,
          unite_id: d.unite_id,
          categorie_id: d.categorie_id,
        });
        await showAlertModal('✅ Modifications enregistrées.');
        await chargerProduits();
      }

      if (res.action === 'delete') {
        const ok = await showConfirmModal('Confirmer la suppression ?');
        if (!ok) return;
        await window.electronAPI.supprimerProduit(id);
        await chargerProduits();
      }
    });
  });

  document.querySelectorAll('.btn-delete-produit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id, 10);
      const ok = await showConfirmModal('Confirmer la suppression ?');
      if (!ok) return;
      await window.electronAPI.supprimerProduit(id);
      await chargerProduits();
    });
  });
}
  window.PageProduits = { renderFormulaireProduit, chargerProduits };
})();
