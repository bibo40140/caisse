// src/renderer/pages/parametres.js
(() => {
	function renderParametresHome() {
  const content = document.getElementById("page-content");
  content.innerHTML = `
    <h2>Paramètres</h2>
    <ul style="display: flex; gap: 20px; list-style: none; padding-left: 0;">
      <li><button id="btn-param-import">📂 Import données</button></li>
      <li><button id="btn-param-historique">🔧 Historique des ventes</button></li>
      <li><button id="btn-param-cotisations">🔧 Cotisations</button></li>
      <li><button id="btn-param-historiquerecetpion">🔧 historique réception</button></li>
      <li><button id="btn-param-categories">🗂️ Gérer les catégories</button></li>
      <li><button id="btn-param-unites">⚖️ Unités</button></li>
      <li><button id="btn-param-modes">💳 Modes de paiement</button></li>
      <li><button id="btn-param-modules">🧩 Modules</button></li>
      <li><button id="btn-param-prospects">👥 Prospects</button></li>
	  <li><button id="btn-sync-push">☁️ Push produits (local → Neon)</button></li>
	  <li><button id="btn-sync-pull">🔁 Pull produits (Neon → local)</button></li>
      <li><button id="btn-param-autres">🔧 Autres paramètres</button></li>
    </ul>
    <div id="parametres-souspage" style="margin-top: 20px;"></div>
  `;

  // Boutons → sous-pages
document.getElementById('btn-param-import').addEventListener('click', () => window.PageImports.renderImportExcel());
  document.getElementById('btn-param-historique')    .addEventListener('click', () => window.renderHistoriqueFactures?.());
  document.getElementById('btn-param-cotisations')   .addEventListener('click', () => window.renderCotisations?.());
  document.getElementById('btn-param-historiquerecetpion')  .addEventListener('click', () => window.PageReceptions?.renderReceptions?.());
  document.getElementById('btn-param-categories')    .addEventListener('click', () => window.renderGestionCategories());
  document.getElementById('btn-param-unites')        .addEventListener('click', () => window.renderGestionUnites());
  document.getElementById('btn-param-modes')         .addEventListener('click', () => window.renderGestionModesPaiement());
  document.getElementById('btn-param-modules')       .addEventListener('click', () => window.renderActivationModules());
  document.getElementById('btn-param-autres')        .addEventListener('click', () => window.renderGestionParametres?.());

  // Prospects (chargement paresseux + dépendance module)
  document.getElementById('btn-param-prospects')?.addEventListener('click', async () => {
    try {
      const mods = await (window.getMods?.() || window.electronAPI.getModules());
      if (!mods?.prospects) {
        alert("Le module Prospects n'est pas activé (Paramètres > Modules).");
        return;
      }
      if (!window.PageProspects?.render) {
        await loadScriptOnce('src/renderer/pages/prospects.js');
      }
      const fn = window.PageProspects?.render || window.renderProspectsPage;
      if (typeof fn === 'function') {
        fn();
      } else {
        alert("Module Prospects non chargé.");
      }
    } catch (e) {
      console.error(e);
      alert("Impossible d'ouvrir la page Prospects.");
    }
  });

  // Masquer certains boutons si module OFF
  (async () => {
    const mods = await (window.getMods?.() || window.electronAPI.getModules());

    const btnCoti = document.getElementById('btn-param-cotisations');
    if (btnCoti) btnCoti.style.display = mods.cotisations ? '' : 'none';

    const btnPros = document.getElementById('btn-param-prospects');
    if (btnPros) btnPros.style.display = mods.prospects ? '' : 'none';

    const btnModes = document.getElementById('btn-param-modes');
    if (btnModes) btnModes.style.display = mods.modes_paiement ? '' : 'none';
  })();
  
  document.getElementById('btn-sync-push')?.addEventListener('click', async () => {
  const r = await window.electronAPI.syncPushProduits();
  if (r?.ok) alert(`Push OK : ${r.applied} produits envoyés vers Neon.`);
  else alert('Push KO : ' + (r?.error || 'inconnu'));
});

document.getElementById('btn-sync-pull')?.addEventListener('click', async () => {
  const r = await window.electronAPI.syncPullProduits();
  if (r?.ok) alert(`Pull OK : ${r.count} produits reçus (table miroir).`);
  else alert('Pull KO : ' + (r?.error || 'inconnu'));
});

  
  
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-dyn="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.dyn = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(s);
  });
}

// --- Paramètres → Catégories (vue familles/catégories) ----------------------
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
      const header = details.header || details;
      const lignes = details.lignes || [];
      const produitsIndex = lignes.map(l => [
        (l.nom || l.produit_nom || ''), (l.fournisseur_nom || ''), (l.unite || ''), (l.code_barre || '')
      ].join(' ')).join(' ').toLowerCase();
      const adherent = `${v.adherent_nom || ''} ${v.adherent_prenom || ''}`.trim();
      const mode = (v.mode_paiement_nom || '').toLowerCase();
      const totalStr = String(v.total ?? '');
      const cotisation = Number(header.cotisation || details.cotisation || 0);
      const searchIndex = [
        adherent, new Date(v.date_vente).toLocaleString(), v.date_vente,
        produitsIndex, mode, totalStr, String(v.id),
        cotisation > 0 ? `cotisation ${cotisation.toFixed(2)}` : ''
      ].join(' ').toLowerCase();
      return {
        vente_id: v.id,
        total: Number(v.total || 0),
        date_vente: v.date_vente,
        adherent,
        mode_paiement_nom: v.mode_paiement_nom || '—',
        frais_paiement: Number(v.frais_paiement || 0),
        searchIndex
      };
    })
  );

  container.innerHTML = `
    <h2>Historique des ventes</h2>
    <input type="text" id="recherche-vente" placeholder="🔍 Rechercher par nom, date, produit, fournisseur, unité, code-barres, mode, total, n° de vente, cotisation..." style="margin-bottom: 10px; padding: 6px; width: 100%;">
    <table class="historique-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Adhérent</th>
          <th>Total</th>
          <th>Paiement</th>
          <th>Frais</th>
          <th>Détail</th>
        </tr>
      </thead>
      <tbody id="ventes-tbody">
        ${ventesAvecProduits.map(v => `
          <tr data-search="${v.searchIndex}">
            <td>${new Date(v.date_vente).toLocaleString()}</td>
            <td>${v.adherent || '—'}</td>
            <td>${v.total.toFixed(2)} €</td>
            <td>${v.mode_paiement_nom || '—'}</td>
            <td>${v.frais_paiement.toFixed(2)} €</td>
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
        const idx = tr.getAttribute('data-search') || '';
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
      const totalProduits = lignes.reduce((s, l) => s + Number(l.prix || 0) * Number(l.quantite || 0), 0);
      const totalGlobal = totalProduits + montantCotisation + fraisPaiement;

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
            ${lignes.map(l => {
              const puOrig = Number(l.prix_unitaire ?? l.prix ?? 0);
              const remise = Number(l.remise_percent || 0);
              const puAppl = Number(l.prix ?? (puOrig * (1 - remise/100)));
              const qte    = Number(l.quantite || 0);
              return `
                <tr>
                  <td>${l.produit_nom || ''}</td>
                  <td>${qte}</td>
                  <td>${puOrig.toFixed(2)} €</td>
                  <td>${remise.toFixed(2)} %</td>
                  <td>${puAppl.toFixed(2)} €</td>
                  <td>${(puAppl * qte).toFixed(2)} €</td>
                </tr>
              `;
            }).join('')}
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
          ${montantCotisation > 0 ? `<strong>Cotisation :</strong> ${montantCotisation.toFixed(2)} €<br>` : ''}
          ${fraisPaiement > 0 ? `<strong>Frais de paiement :</strong> ${fraisPaiement.toFixed(2)} €<br>` : ''}
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

  const current = await window.electronAPI.getModules();

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
      .mod-child .mod-head label { font-weight: 600; }
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
          getChildren(k).forEach(ch => stack.push(ch));
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
      if (!payload.stocks) {
        payload.inventaire = false;
      }
      if (!payload.fournisseurs) {
        payload.receptions = false;
      }

      const input = document.getElementById('ext-margin-input');
      if (input) {
        let v = parseFloat(input.value);
        if (!Number.isFinite(v) || v < 0) v = 30;
        await window.electronAPI.setVentesMargin(v);
      }

      await window.electronAPI.setModules(payload);
      if (window.clearModsCache) window.clearModsCache();
      window.location.reload();
    } catch (e) {
      alert("Erreur lors de l'enregistrement : " + (e?.message || e));
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
}

// === Export global ==========================================================
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
