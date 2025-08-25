// src/renderer/pages/imports.js
(() => {

  function renderImportExcel() {
    const container = document.getElementById('parametres-souspage');
    const exemplesEntetes = {
      produits: ["nom", "prix", "stock", "unite", "code_barre", "fournisseur"],
      fournisseurs: [
        "nom", "contact", "email", "telephone",
        "adresse", "code_postal", "ville",
        "categorie", "referent", "label"
      ],
      adherents: [
        "nom", "prenom", "email1", "email2",
        "telephone1", "telephone2",
        "adresse", "code_postal", "ville",
        "nb_personnes_foyer", "tranche_age",
        "date_inscription", "date_archivage", "date_reactivation"
      ],
      categories: ["nom"]
    };
    const fichiersModele = {
      produits: "modele_produits.xlsx",
      fournisseurs: "modele_fournisseurs.xlsx",
      adherents: "modele_adherents.xlsx",
      categories: "modele_categories.xlsx"
    };
    container.innerHTML = `
      <h2>📥 Import de fichiers Excel</h2>
      <div class="import-grid">
        <div class="import-block">
          <h3>🛒 Produits</h3>
          <p>📥 <a href="${fichiersModele.produits}" download target="_blank">Télécharger le modèle Excel</a></p>
          <p>Colonnes attendues :</p>
          <ul>${exemplesEntetes.produits.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
          <button class="btn-import" id="btn-import-produits">📂 Choisir un fichier Excel</button>
          <div id="produits-import-result" class="import-result"></div>
        </div>

        <div class="import-block">
          <h3>🚚 Fournisseurs</h3>
          <p>📥 <a href="${fichiersModele.fournisseurs}" download target="_blank">Télécharger le modèle Excel</a></p>
          <p>Colonnes attendues :</p>
          <ul>${exemplesEntetes.fournisseurs.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
          <button class="btn-import" id="btn-import-fournisseurs">📂 Choisir un fichier Excel</button>
          <div id="fournisseurs-import-result" class="import-result"></div>
        </div>

        <div class="import-block">
          <h3>👥 Adhérents</h3>
          <p>📥 <a href="${fichiersModele.adherents}" download target="_blank">Télécharger le modèle Excel</a></p>
          <p>Colonnes attendues :</p>
          <ul>${exemplesEntetes.adherents.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
          <button class="btn-import" id="btn-import-adherents">📂 Choisir un fichier Excel</button>
          <div id="adherents-import-result" class="import-result"></div>
        </div>
      </div>
    `;

    document.getElementById('btn-import-produits')?.addEventListener('click', renderImportProduits);
    document.getElementById('btn-import-fournisseurs')?.addEventListener('click', renderImportFournisseurs);
    document.getElementById('btn-import-adherents')?.addEventListener('click', renderImportAdherents);
  }

  // ========= IMPORT PRODUITS (avec héritage catégorie + wizard conflits) =========
  async function renderImportProduits() {
    const container = document.getElementById('parametres-souspage');
    const filePath = await window.electronAPI.choisirFichier();
    if (!filePath) { container.innerHTML = `<p>Aucun fichier sélectionné.</p>`; return; }
    container.innerHTML = `<p>Chargement du fichier...</p>`;

    const data = await window.electronAPI.analyserImportProduits(filePath);
    if (!data || data.status !== 'ok') {
      container.innerHTML = `<p>Erreur lors de l'import du fichier.</p>`;
      return;
    }

    const { produits, unitesConnues, fournisseurs } = data;

    // base fournisseurs (avec leur categorie_id)
    const fournisseursFull = await window.electronAPI.getFournisseurs();
    const fourFullById     = new Map(fournisseursFull.map(f => [Number(f.id), f]));
    const fourByNameLite   = new Map(fournisseurs.map(f => [String(f.nom || '').toLowerCase(), f])); // issus du parse

    // catégories
    const catsDetailed     = await window.getCategoriesDetailed();
    const categorieById    = new Map(catsDetailed.map(c => [Number(c.id), c]));
    const categorieByName  = new Map(catsDetailed.map(c => [String(c.nom || '').toLowerCase(), c]));

    // Normalise + pré-sélectionne la catégorie héritée du fournisseur
    produits.forEach(p => {
      if (p.unite_valide) p.unite = p.unite_valide;

      if (!p.fournisseur_id && p.fournisseur) {
        const fLite = fourByNameLite.get(String(p.fournisseur).toLowerCase());
        if (fLite) p.fournisseur_id = Number(fLite.id);
      }

      let hadCatFromFile = false;
      if (!p.categorie_id && p.categorie_nom) {
        const c = categorieByName.get(String(p.categorie_nom).toLowerCase());
        if (c) {
          p.categorie_id  = Number(c.id);
          p.categorie_nom = c.nom;
          hadCatFromFile  = true;
        }
      }

      if (!p.categorie_id && p.fournisseur_id) {
        const fFull = fourFullById.get(Number(p.fournisseur_id));
        if (fFull && fFull.categorie_id) {
          p.categorie_id  = Number(fFull.categorie_id);
          p.categorie_nom = fFull.categorie_nom || (categorieById.get(Number(fFull.categorie_id))?.nom || '');
          p._catTouched   = false;
        }
      }
      if (hadCatFromFile) p._catTouched = true;
      if (p._catTouched == null) p._catTouched = false;
    });

    // ========= UI liste import =========
    container.innerHTML = `
      <h3>Prévisualisation des produits importés</h3>
      <div style="margin-bottom:10px;display:flex;gap:10px;align-items:center;">
        <input id="filtre-produits-import" placeholder="🔍 Filtrer (nom, code-barre…)" style="flex:1;padding:6px;">
        <span id="compteur-produits" style="opacity:.7;"></span>
      </div>
      <table class="table-import" id="table-import-produits">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Prix</th>
            <th>Stock</th>
            <th>Code barre</th>
            <th>Unité</th>
            <th>Fournisseur</th>
            <th>Catégorie produit</th>
          </tr>
        </thead>
        <tbody id="tbody-import-produits"></tbody>
      </table>
      <button class="btn-valider" id="valider-import-produits" style="margin-top: 20px;">✅ Valider l'import</button>
      <div id="result-import-produits" style="margin-top: 30px;"></div>
    `;

    // style surlignage
    if (!document.getElementById('import-missing-style')) {
      const st = document.createElement('style');
      st.id = 'import-missing-style';
      st.textContent = `
        .row-missing { background: #fff7e6 !important; }
        .row-missing-cat { position: relative; }
        .row-missing-cat::before { content:''; position:absolute; left:0; top:0; bottom:0; width:6px; background:#ffd1d9; }
      `;
      document.head.appendChild(st);
    }

    const tbody       = document.getElementById('tbody-import-produits');
    const filtreInput = document.getElementById('filtre-produits-import');
    const compteur    = document.getElementById('compteur-produits');

    const computeMissing = () => {
      const out = [];
      produits.forEach((p, i) => {
        const miss = [];
        if (!p.unite) miss.push('unite');
        if (!p.fournisseur_id) miss.push('fournisseur_id');
        if (miss.length) out.push({ i, miss });
      });
      return out;
    };

    const updateRowClasses = (tr, p) => {
      if (!tr) return;
      const hardMissing = !(p.unite && p.fournisseur_id);
      const catMissing  = !p.categorie_id;
      tr.classList.toggle('row-missing', hardMissing);
      tr.classList.toggle('row-missing-cat', catMissing);
    };

    function renderRows() {
      const q = (filtreInput.value || '').toLowerCase().trim();
      const rows = produits.map((p, i) => {
        const match = !q ||
          (p.nom || '').toLowerCase().includes(q) ||
          (String(p.code_barre || '')).includes(q);
        if (!match) return '';
        return `
          <tr data-index="${i}">
            <td>${p.nom}</td>
            <td>${p.prix ?? ''}</td>
            <td>${p.stock ?? ''}</td>
            <td>${p.code_barre || ''}</td>
            <td>
              <select data-index="${i}" class="select-unite">
                <option value="">-- Choisir --</option>
                ${unitesConnues.map(u => `
                  <option value="${u.nom}" ${p.unite === u.nom ? 'selected' : ''}>${u.nom}</option>
                `).join('')}
              </select>
            </td>
            <td>
              <select data-index="${i}" class="select-fournisseur">
                <option value="">-- Choisir --</option>
                ${fournisseurs.map(f => `
                  <option value="${f.id}" ${String(p.fournisseur_id) === String(f.id) ? 'selected' : ''}>${f.nom}</option>
                `).join('')}
              </select>
            </td>
            <td>
              <select data-index="${i}" class="select-categorie">
                <option value="">-- Aucune / héritée du fournisseur --</option>
                ${window.buildCategoryOptionsGrouped(catsDetailed, p.categorie_id || null)}
              </select>
            </td>
          </tr>
        `;
      }).join('');
      tbody.innerHTML = rows;

      produits.forEach((p, i) => {
        const tr = tbody.querySelector(`tr[data-index="${i}"]`);
        if (tr) updateRowClasses(tr, p);
      });

      // handlers
      tbody.querySelectorAll('.select-unite').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.index, 10);
          produits[idx].unite = e.target.value || null;
          updateRowClasses(tbody.querySelector(`tr[data-index="${idx}"]`), produits[idx]);
        });
      });

      tbody.querySelectorAll('.select-fournisseur').forEach(sel => {
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.index, 10);
          const val = e.target.value;
          produits[idx].fournisseur_id = val ? parseInt(val, 10) : null;

          if (!produits[idx]._catTouched && produits[idx].fournisseur_id) {
            const fFull = fourFullById.get(produits[idx].fournisseur_id);
            if (fFull && fFull.categorie_id) {
              produits[idx].categorie_id  = Number(fFull.categorie_id);
              produits[idx].categorie_nom = fFull.categorie_nom || (categorieById.get(Number(fFull.categorie_id))?.nom || '');
              const tr   = tbody.querySelector(`tr[data-index="${idx}"]`);
              const selC = tr?.querySelector('.select-categorie');
              if (selC) {
                selC.value = String(produits[idx].categorie_id);
                window.SearchableSelect?.sync?.(selC);
              }
            }
          }
          updateRowClasses(tbody.querySelector(`tr[data-index="${idx}"]`), produits[idx]);
        });
      });

      tbody.querySelectorAll('.select-categorie').forEach(sel => {
        sel.classList.add('select-categorie');
        sel.addEventListener('change', e => {
          const idx = parseInt(e.target.dataset.index, 10);
          const val = e.target.value;
          produits[idx].categorie_id  = val ? parseInt(val, 10) : null;
          produits[idx].categorie_nom = val ? (categorieById.get(parseInt(val, 10))?.nom || '') : '';
          produits[idx]._catTouched   = true;
          updateRowClasses(tbody.querySelector(`tr[data-index="${idx}"]`), produits[idx]);
        });
      });

      // active l’overlay
      window.SearchableSelect?.init(tbody);

      const nbVisibles = [...tbody.querySelectorAll('tr')].length;
      compteur.textContent = `${nbVisibles} / ${produits.length} visibles`;
    }

    renderRows();
    filtreInput.addEventListener('input', renderRows);

    // ========= Wizard de conflits =========
    const canDeleteExisting = typeof window.electronAPI?.supprimerProduit === 'function';

    const buildConflictForm = (modif, index, total) => {
      const existant = modif.existant || {};
      const nouveau  = modif.nouveau  || {};
      const wrap = document.createElement('form');

      const diffCell = (a, b) => {
        const same = String(a ?? '') === String(b ?? '');
        return same
          ? `<div>${a ?? '—'}</div>`
          : `<div>
               <div style="text-decoration:line-through;opacity:.6">${a ?? '—'}</div>
               <div><strong>${b ?? '—'}</strong></div>
             </div>`;
      };

      const uniteOptions = `
        <option value="">-- Choisir --</option>
        ${unitesConnues.map(u => `<option value="${u.nom}" ${nouveau.unite === u.nom ? 'selected':''}>${u.nom}</option>`).join('')}
      `;

      const catSelect = `
        <select name="categorie_id" class="select-categorie-conflit">
          <option value="">-- Aucune / héritée --</option>
          ${window.buildCategoryOptionsGrouped(catsDetailed, nouveau.categorie_id || null)}
        </select>
      `;

      wrap.innerHTML = `
        <div style="min-width:720px">
          <h4>Conflit ${index+1} / ${total}</h4>
          <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
            <thead>
              <tr><th style="width:50%;">Existant</th><th style="width:50%;">Importé</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${existant.nom || '—'}</strong><br>Fournisseur : ${existant.fournisseur_nom || '—'}</td>
                <td><strong>${nouveau.nom || '—'}</strong><br>Fournisseur : ${nouveau.fournisseur_nom || '—'}</td>
              </tr>
              <tr>
                <td>Unité : ${existant.unite || '—'}</td>
                <td>Unité :
                  <select name="unite" class="select-unite-conflit">${uniteOptions}</select>
                </td>
              </tr>
              <tr>
                <td>Catégorie : ${existant.categorie_nom || '—'}</td>
                <td>Catégorie : ${catSelect}</td>
              </tr>
              <tr>
                <td>Code-barre : ${existant.code_barre || '—'}</td>
                <td>Code-barre : ${diffCell(existant.code_barre, nouveau.code_barre)}</td>
              </tr>
              <tr>
                <td>Prix : ${existant.prix ?? '—'}</td>
                <td>Prix : ${diffCell(existant.prix, nouveau.prix)}</td>
              </tr>
              <tr>
                <td>Stock : ${existant.stock ?? '—'}</td>
                <td>Stock : ${diffCell(existant.stock, nouveau.stock)}</td>
              </tr>
            </tbody>
          </table>

          <fieldset style="margin-top:10px;">
            <legend>Action</legend>
            <label><input type="radio" name="action" value="ignorer"> Conserver l’existant</label><br>
            <label><input type="radio" name="action" value="remplacer" checked> Écraser (remplacer l’existant par l’importé)</label><br>
            <label><input type="radio" name="action" value="ajouter"> Ajouter comme nouveau produit</label><br>
            ${canDeleteExisting ? `<label><input type="radio" name="action" value="supprimer"> Supprimer l’existant puis ajouter</label>` : ''}
          </fieldset>
        </div>
      `;

      // rends la catégorie searchable dans la popup
      try { window.SearchableSelect?.wire(wrap.querySelector('.select-categorie-conflit')); } catch {}
      return wrap;
    };

    async function resolveConflictsWizard(modifications) {
      const decisions = [];
      for (let i = 0; i < modifications.length; i++) {
        const form = buildConflictForm(modifications[i], i, modifications.length);
        const ok = await showFormModal('Conflit sur un produit', form);
        if (!ok) return null; // annulation

        const action = (form.querySelector('input[name="action"]:checked')?.value) || 'remplacer';

        // applique les modifs de saisie sur "nouveau"
        const nouveau = { ...modifications[i].nouveau };
        const uVal = form.querySelector('.select-unite-conflit')?.value || '';
        const cVal = form.querySelector('.select-categorie-conflit')?.value || '';

        // Unité → possibilité de mapper en ID pour le backend, si nécessaire
        if (uVal) {
          nouveau.unite = uVal;
          const u = unitesConnues.find(x => String(x.nom).toLowerCase() === String(uVal).toLowerCase());
          if (u) nouveau.unite_id = u.id;
        } else {
          nouveau.unite = null;
          nouveau.unite_id = null;
        }

        // Catégorie
        if (cVal) {
          nouveau.categorie_id  = parseInt(cVal, 10);
          nouveau.categorie_nom = (categorieById.get(nouveau.categorie_id)?.nom || '');
        } else {
          nouveau.categorie_id  = null;
          nouveau.categorie_nom = '';
        }

        nouveau.fournisseur_id = parseInt(nouveau.fournisseur_id || 0, 10) || null;

        decisions.push({ action, modif: modifications[i], nouveau });
      }
      return decisions;
    }

    // ========= Validation / backend =========
    document.getElementById('valider-import-produits').addEventListener('click', async () => {
      const missing = computeMissing();
      if (missing.length > 0) {
        await showAlertModal('⚠️ Certain(e)s produit(s) n’ont pas d’unité et/ou de fournisseur. Complète-les avant de valider.');
        return;
      }

      const confirm = await showConfirmModal(`Confirmer l'import de ${produits.length} produit(s) ?`);
      if (!confirm) return;

      // 1) On envoie l’ensemble ; le backend renvoie "partiel" + modifications s’il y a des conflits
      const resultat = await window.electronAPI.validerImportProduits(produits);
      const resultDiv = document.getElementById('result-import-produits');
      resultDiv.innerHTML = '';

      if (resultat.status === 'ok') {
        await showAlertModal("✅ Import terminé !");
        renderImportExcel();
        return;
      }

      if (resultat.status === 'partiel' && Array.isArray(resultat.modifications) && resultat.modifications.length) {
        // 2) Wizard de conflits
        const decisions = await resolveConflictsWizard(resultat.modifications);
        if (!decisions) return; // annulation par l’utilisateur

        // 3) Application des décisions
        for (const d of decisions) {
          const { action, modif, nouveau } = d;
          if (action === 'remplacer') {
            await window.electronAPI.resoudreConflitProduit('remplacer', nouveau, modif.idExistant);
          } else if (action === 'ajouter') {
            await window.electronAPI.resoudreConflitProduit('ajouter', nouveau);
          } else if (action === 'supprimer') {
            if (canDeleteExisting) {
              try { await window.electronAPI.supprimerProduit(modif.idExistant); } catch {}
              await window.electronAPI.resoudreConflitProduit('ajouter', nouveau);
            } else {
              // fallback si suppression indisponible : on remplace
              await window.electronAPI.resoudreConflitProduit('remplacer', nouveau, modif.idExistant);
            }
          } else {
            // ignorer (conserver l’existant) -> rien
          }
        }

        await showAlertModal("✅ Conflits résolus, import terminé !");
        renderImportExcel();
        return;
      }

      // cas inattendu
      await showAlertModal(resultat?.message || "Import terminé (aucune modification retournée).");
      renderImportExcel();
    });
  }

  // ========= IMPORT FOURNISSEURS (inchangé avec petites finitions) =========
  async function renderImportFournisseurs() {
    const container = document.getElementById('parametres-souspage');
    const filePath = await window.electronAPI.choisirFichier();
    if (!filePath) { container.innerHTML = `<p>Aucun fichier sélectionné.</p>`; return; }

    container.innerHTML = `<p>Chargement du fichier...</p>`;
    const data = await window.electronAPI.analyserImportFournisseurs(filePath);
    if (!data || data.status !== 'ok') { container.innerHTML = `<p>Erreur lors de l'import du fichier.</p>`; return; }

    const { fournisseurs, categories: fileCategories, referents } = data;
    const catsDetailed = await window.getCategoriesDetailed();
    const existants    = await window.electronAPI.getFournisseurs();

    if (!document.getElementById('import-missing-cell-style')) {
      const st = document.createElement('style');
      st.id = 'import-missing-cell-style';
      st.textContent = ` td.cell-missing { background:#fff7e6; } `;
      document.head.appendChild(st);
    }

    const fournisseursSansDoublons = [];
    const conflits = [];

    for (const f of fournisseurs) {
      const doublon = existants.find(e => String(e.nom || '').toLowerCase() === String(f.nom || '').toLowerCase());

      const cat = fileCategories.find(c => String(c.nom || '').toLowerCase() === String(f.categorie_nom || '').toLowerCase());
      if (cat) f.categorie_id = cat.id;

      const ref = referents.find(r => (`${r.nom} ${r.prenom}`).toLowerCase().trim() === String(f.referent || '').toLowerCase().trim());
      if (ref) f.referent_id = ref.id;

      if (doublon) conflits.push({ nouveau: f, existant: doublon });
      else fournisseursSansDoublons.push(f);
    }

    const htmlMain = `
      <h3>Fournisseurs à importer (${fournisseursSansDoublons.length})</h3>
      <table class="table-import" id="table-import-fournisseurs">
        <thead>
          <tr>
            <th>Nom</th><th>Contact</th><th>Email</th><th>Téléphone</th><th>Adresse</th>
            <th>CP</th><th>Ville</th><th>Catégorie</th><th>Référent</th><th>Label</th>
          </tr>
        </thead>
        <tbody>
          ${fournisseursSansDoublons.map((f, i) => `
            <tr>
              <td>${f.nom || ''}</td>
              <td>${f.contact || ''}</td>
              <td>${f.email || ''}</td>
              <td>${f.telephone || ''}</td>
              <td>${f.adresse || ''}</td>
              <td>${f.code_postal || ''}</td>
              <td>${f.ville || ''}</td>
              <td class="td-cat">
                <select data-index="${i}" class="select-categorie">
                  <option value="">-- Choisir --</option>
                  ${window.buildCategoryOptionsGrouped(catsDetailed, f.categorie_id || null)}
                </select>
              </td>
              <td class="td-ref">
                <select data-index="${i}" class="select-referent">
                  <option value="">-- Choisir --</option>
                  ${referents.map(r => `<option value="${r.id}" ${f.referent_id === r.id ? 'selected' : ''}>${r.nom} ${r.prenom}</option>`).join('')}
                </select>
              </td>
              <td>${f.label || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const htmlConf = conflits.length ? `
      <h3>Conflits détectés (${conflits.length})</h3>
      <table class="table-import" id="table-import-fournisseurs-conflits">
        <thead>
          <tr><th>Nom</th><th>Catégorie</th><th>Référent</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${conflits.map((c, i) => `
            <tr>
              <td>${c.nouveau.nom}</td>
              <td class="td-cat">
                <select data-index="${i}" class="select-categorie-conflit">
                  <option value="">-- Choisir --</option>
                  ${window.buildCategoryOptionsGrouped(catsDetailed, c.nouveau.categorie_id || null)}
                </select>
              </td>
              <td class="td-ref">
                <select data-index="${i}" class="select-referent-conflit">
                  <option value="">-- Choisir --</option>
                  ${referents.map(r => `<option value="${r.id}" ${c.nouveau.referent_id === r.id ? 'selected' : ''}>${r.nom} ${r.prenom}</option>`).join('')}
                </select>
              </td>
              <td>
                <select data-index="${i}" class="select-action-conflit">
                  <option value="conserver">✅ Conserver l’existant</option>
                  <option value="remplacer">♻️ Remplacer l’existant</option>
                  <option value="ajouter">➕ Ajouter quand même</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '';

    container.innerHTML = htmlMain + htmlConf + `<button id="valider-import-fournisseurs" class="btn-valider" style="margin-top: 20px;">✅ Valider l'import</button>`;

    // autowire SearchableSelect
    window.SearchableSelect?.init(container);

    function refreshMissingCells(scope) {
      (scope || container).querySelectorAll('tbody tr').forEach(tr => {
        const tdCat = tr.querySelector('.td-cat');
        const tdRef = tr.querySelector('.td-ref');
        const selCat = tr.querySelector('select.select-categorie, select.select-categorie-conflit');
        const selRef = tr.querySelector('select.select-referent, select.select-referent-conflit');
        if (tdCat && selCat) tdCat.classList.toggle('cell-missing', !selCat.value);
        if (tdRef && selRef) tdRef.classList.toggle('cell-missing', !selRef.value);
      });
    }
    refreshMissingCells();

    container.querySelectorAll('.select-categorie').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        fournisseursSansDoublons[index].categorie_id = v ? parseInt(v, 10) : null;
        refreshMissingCells(sel.closest('tr'));
      });
    });
    container.querySelectorAll('.select-referent').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        fournisseursSansDoublons[index].referent_id = v ? parseInt(v, 10) : null;
        refreshMissingCells(sel.closest('tr'));
      });
    });

    container.querySelectorAll('.select-categorie-conflit').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        conflits[index].nouveau.categorie_id = v ? parseInt(v, 10) : null;
        refreshMissingCells(sel.closest('tr'));
      });
    });
    container.querySelectorAll('.select-referent-conflit').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        conflits[index].nouveau.referent_id = v ? parseInt(v, 10) : null;
        refreshMissingCells(sel.closest('tr'));
      });
    });

    container.querySelector('#valider-import-fournisseurs').addEventListener('click', async () => {
      const actions = [];
      container.querySelectorAll('.select-action-conflit').forEach(sel => {
        const index = parseInt(sel.dataset.index, 10);
        const action = sel.value;
        actions.push({ ...conflits[index], action });
      });

      for (const c of actions) {
        const { action, nouveau, existant } = c;
        if (action === 'remplacer') {
          await window.electronAPI.resoudreConflitFournisseur('remplacer', nouveau, existant.id);
        } else if (action === 'ajouter') {
          fournisseursSansDoublons.push(nouveau);
        }
      }

      const incomplets = fournisseursSansDoublons.filter(f => !f.categorie_id || !f.referent_id).length;
      if (incomplets) {
        const ok = await showConfirmModal(`⚠️ ${incomplets} ligne(s) sans catégorie ou référent. Continuer quand même ?`);
        if (!ok) return;
      }

      const result = await window.electronAPI.validerImportFournisseurs(fournisseursSansDoublons);
      await showAlertModal(result?.message || "Import terminé.");
      renderImportExcel();
    });
  }

  // (placeholder simple)
  async function renderImportAdherents() {
    const container = document.getElementById('parametres-souspage');
    const filePath = await window.electronAPI.choisirFichier();
    if (!filePath) { container.innerHTML = `<p>Aucun fichier sélectionné.</p>`; return; }
    const res = await window.electronAPI.importerExcel('adherents', filePath);
    await showAlertModal(res?.message || "Import adhérents terminé.");
    renderImportExcel();
  }

  window.PageImports = {
    renderImportExcel,
    renderImportProduits,
    renderImportFournisseurs,
    renderImportAdherents,
  };

})();
