// src/renderer/pages/fournisseurs.js
(() => {

  async function chargerFournisseurs() {
    const fournisseurs = await window.electronAPI.getFournisseurs();

    const content = document.getElementById("page-content");
    content.innerHTML = `
      <h2>Liste des fournisseurs</h2>

      <input
        type="text"
        id="filtre-fournisseur"
        placeholder="🔍 Rechercher un fournisseur (par nom)…"
        list="liste-noms-fournisseurs"
        style="width: 300px; padding: 5px;"
      >
      <datalist id="liste-noms-fournisseurs">
        ${fournisseurs.map(f => `<option value="${f.nom}">`).join('')}
      </datalist>
      <button id="btn-ajouter-fournisseur">+ Ajouter un fournisseur</button>

      <br><br>

      <table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse: collapse;">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Téléphone</th>
            <th>Adresse</th>
            <th>Code Postal</th>
            <th>Ville</th>
            <th>Catégorie</th>
            <th>Référent</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="fournisseurs-liste">
          ${fournisseurs.map(f => `
            <tr>
              <td>${f.nom}</td>
              <td>${f.email || ''}</td>
              <td>${f.telephone || ''}</td>
              <td>${f.adresse || ''}</td>
              <td>${f.code_postal || ''}</td>
              <td>${f.ville || ''}</td>
              <td>${f.categorie_nom || '—'}</td>
              <td>${f.referent || '—'}</td>
              <td style="white-space: nowrap;">
                <button type="button" data-id="${f.id}" class="btn-modifier">✏️ Modifier</button>
                <button type="button" data-id="${f.id}" class="btn-supprimer-fournisseur" style="margin-left: 5px; background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">🗑️ Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // 🔍 Filtre en direct
    const inputFiltre = document.getElementById('filtre-fournisseur');
    inputFiltre.addEventListener('input', (e) => {
      const terme = (e.target.value || '').toLowerCase();
      const lignes = document.querySelectorAll('#fournisseurs-liste tr');
      lignes.forEach(row => {
        const nom = row.querySelector('td:nth-child(1)')?.textContent.toLowerCase() || '';
        row.style.display = nom.includes(terme) ? '' : 'none';
      });
    });

    // Sur "change", on restreint via includes et on centre le 1er match
    inputFiltre.addEventListener('change', (e) => {
      const choisi = (e.target.value || '').toLowerCase().trim();
      const lignes = document.querySelectorAll('#fournisseurs-liste tr');

      let firstMatch = null;
      lignes.forEach(row => {
        const nom = row.querySelector('td:nth-child(1)')?.textContent.toLowerCase() || '';
        const match = nom.includes(choisi);
        row.style.display = match ? '' : 'none';
        if (match && !firstMatch) firstMatch = row;
      });

      if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // ➕ Ajouter un fournisseur
    document.getElementById('btn-ajouter-fournisseur').addEventListener('click', async () => {
      const categories = await window.getCategoriesDetailed();
      const adherents  = await window.electronAPI.getAdherents();

      const form = document.createElement("form");
      form.innerHTML = `
        <label>Nom : <input name="nom" required></label><br><br>
        <label>Contact : <input name="contact"></label><br><br>
        <label>Email : <input name="email" type="email"></label><br><br>
        <label>Téléphone : <input name="telephone" type="tel"></label><br><br>
        <label>Adresse : <input name="adresse"></label><br><br>
        <label>Code Postal : <input name="code_postal"></label><br><br>
        <label>Ville : <input name="ville"></label><br><br>

        <label>Référent :
          <select name="referent_id">
            <option value="">-- Aucun --</option>
            ${adherents.map(a => `
              <option value="${a.id}" data-email="${(a.email1 || '').trim()}">${a.nom} ${a.prenom}</option>
            `).join('')}
          </select>
        </label><br><br>

        <label>Catégorie :
          <select name="categorie_id" class="select-categorie">
            <option value="">-- Aucune --</option>
            ${window.buildCategoryOptionsGrouped(categories, null)}
          </select>
        </label>
        <br><br>

        <label>Label : <input name="label"></label><br><br>
      `;

      // L’auto-câblage global de parametres.js gère ce select (hors import fournisseurs)

      const ok = await showFormModal("Ajouter un fournisseur", form);
      if (!ok) return;

      const data = {
        nom: form.nom.value.trim(),
        contact: form.contact.value.trim(),
        email: form.email.value.trim(),
        telephone: form.telephone.value.trim(),
        adresse: form.adresse.value.trim(),
        code_postal: form.code_postal.value.trim(),
        ville: form.ville.value.trim(),
        referent_id: form.referent_id.value ? parseInt(form.referent_id.value, 10) : null,
        categorie_id: form.categorie_id.value ? parseInt(form.categorie_id.value, 10) : null,
        label: form.label.value.trim()
      };

      const existant = await window.electronAPI.rechercherFournisseurParNom(data.nom);
      if (existant) {
        const choix = await showChoixModal(`
          ⚠️ Un fournisseur nommé <strong>${existant.nom}</strong> existe déjà.<br><br>
          Que souhaitez-vous faire ?
        `, ['Remplacer', 'Ajouter quand même', 'Annuler']);

        if (choix === 'Annuler') return;

        if (choix === 'Remplacer') {
          data.id = existant.id;
          await window.electronAPI.modifierFournisseur(data);
          await showAlertModal("🔁 Fournisseur remplacé !");
          return await chargerFournisseurs();
        }
        // Sinon on continue avec l'ajout classique
      }

      await window.electronAPI.ajouterFournisseur(data);
      await showAlertModal("✅ Fournisseur ajouté !");
      await chargerFournisseurs();
    });

    // ✏️ DÉLÉGATION : clic sur "Modifier" (robuste après filtrage)
    const tbody = document.getElementById('fournisseurs-liste');
    tbody.addEventListener('click', async (e) => {
      // Gérer le bouton Supprimer
      const btnSupprimer = e.target.closest('.btn-supprimer-fournisseur');
      if (btnSupprimer) {
        const id = Number(btnSupprimer.dataset.id);
        const fournisseur = (fournisseurs || []).find(f => Number(f.id) === id);
        if (!fournisseur) return;

        const confirmation = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le fournisseur "${fournisseur.nom}" ?`);
        if (!confirmation) return;

        try {
          await window.electronAPI.supprimerFournisseur(id);
          await showAlertModal('✅ Fournisseur supprimé.');
          await chargerFournisseurs();
        } catch (err) {
          await showAlertModal(`❌ Erreur lors de la suppression : ${err?.message || err}`);
        }
        return;
      }

      // Gérer le bouton Modifier
      const btn = e.target.closest('.btn-modifier');
      if (!btn) return;

      const id = Number(btn.dataset.id);
      const fournisseur = (fournisseurs || []).find(f => Number(f.id) === id);
      if (!fournisseur) return;

      const [categories, adherents] = await Promise.all([
        window.getCategoriesDetailed(),
        window.electronAPI.getAdherents()
      ]);

      const form = document.createElement('form');
      form.innerHTML = `
        <div style="display:grid; gap:10px;">
          <label>Nom : <input name="nom" required></label>
          <label>Contact : <input name="contact"></label>
          <label>Email : <input name="email" type="email"></label>
          <label>Téléphone : <input name="telephone" type="tel"></label>
          <label>Adresse : <input name="adresse"></label>
          <label>Code Postal : <input name="code_postal"></label>
          <label>Ville : <input name="ville"></label>

          <label>Référent :
            <select name="referent_id">
              <option value="">-- Aucun --</option>
              ${adherents.map(a => `<option value="${a.id}">${a.nom} ${a.prenom}</option>`).join('')}
            </select>
          </label>

          <label>Catégorie :
            <select name="categorie_id" class="select-categorie">
              <option value="">-- Aucune --</option>
              ${window.buildCategoryOptionsGrouped(categories, fournisseur.categorie_id || null)}
            </select>
          </label>

          <label>Label : <input name="label"></label>
        </div>
      `;

      // Pré-remplissage
      form.nom.value         = fournisseur.nom || '';
      form.contact.value     = fournisseur.contact || '';
      form.email.value       = fournisseur.email || '';
      form.telephone.value   = fournisseur.telephone || '';
      form.adresse.value     = fournisseur.adresse || '';
      form.code_postal.value = fournisseur.code_postal || '';
      form.ville.value       = fournisseur.ville || '';
      form.label.value       = fournisseur.label || '';

      if (fournisseur.referent_id) {
        const opt = form.referent_id.querySelector(`option[value="${fournisseur.referent_id}"]`);
        if (opt) opt.selected = true;
      }

      // L’auto-câblage global de parametres.js gère ce select (hors import fournisseurs)

      const ok = await showFormModal('Modifier un fournisseur', form);
      if (!ok) return;

      await window.electronAPI.modifierFournisseur({
        id,
        nom: form.nom.value.trim(),
        contact: form.contact.value.trim(),
        email: form.email.value.trim(),
        telephone: form.telephone.value.trim(),
        adresse: form.adresse.value.trim(),
        code_postal: form.code_postal.value.trim(),
        ville: form.ville.value.trim(),
        referent_id: form.referent_id.value ? Number(form.referent_id.value) : null,
        categorie_id: form.categorie_id.value ? Number(form.categorie_id.value) : null,
        label: form.label.value.trim()
      });

      await showAlertModal('✅ Modifications enregistrées.');
      await chargerFournisseurs();
    });
  }

  // === Legacy (si appelé ailleurs) ===
  async function ajouterFournisseur() {
    const categories = await window.getCategoriesDetailed();
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <h2>Ajouter un fournisseur</h2>
      <form id="form-fournisseur">
        <label>Nom : <input name="nom" required></label><br><br>
        <label>Email : <input name="email" type="email"></label><br><br>
        <label>Téléphone : <input name="telephone" type="tel"></label><br><br>
        <label>Adresse : <input name="adresse"></label><br><br>
        <label>Code Postal : <input name="code_postal"></label><br><br>
        <label>Ville : <input name="ville"></label><br><br>
        <label>Référent : <input name="referent"></label><br><br>
        <label>Catégorie :
          <select name="categorie_id" class="select-categorie">
            <option value="">-- Aucune --</option>
            ${window.buildCategoryOptionsGrouped(categories, null)}
          </select>
        </label><br><br>
        <button type="submit">Enregistrer</button>
        <button type="button" onclick="navigate('fournisseurs')">Annuler</button>
      </form>
    `;

    document.getElementById('form-fournisseur').addEventListener('submit', (e) => {
      e.preventDefault();
      alert("À implémenter : enregistrement en base !");
    });
  }

  function modifierFournisseur(id) {
    alert("Modifier le fournisseur ID " + id);
  }

  // === Import Fournisseurs (page paramètres) ===
  async function renderImportFournisseurs() {
    const container = document.getElementById('parametres-souspage');
    const filePath = await window.electronAPI.choisirFichier();
    if (!filePath) {
      container.innerHTML = `<p>Aucun fichier sélectionné.</p>`;
      return;
    }

    container.innerHTML = `<p>Chargement du fichier...</p>`;
    const data = await window.electronAPI.analyserImportFournisseurs(filePath);
    if (!data || data.status !== 'ok') {
      container.innerHTML = `<p>Erreur lors de l'import du fichier.</p>`;
      return;
    }

    // Les catégories/référents détectés à partir du fichier
    const { fournisseurs, categories: fileCategories, referents } = data;
    // Pour l’affichage des <select>, on recharge la liste détaillée (avec familles)
    const catsDetailed = await window.getCategoriesDetailed();

    const existants = await window.electronAPI.getFournisseurs();

    const fournisseursSansDoublons = [];
    const conflits = [];

    for (const f of fournisseurs) {
      const doublon = existants.find(e => e.nom.toLowerCase() === f.nom.toLowerCase());

      // Détection catégorie existante (à partir du parsing du fichier)
      const cat = fileCategories.find(c => c.nom.toLowerCase() === (f.categorie_nom || '').toLowerCase());
      if (cat) f.categorie_id = cat.id;

      // Détection référent existant
      const ref = referents.find(r => (`${r.nom} ${r.prenom}`).toLowerCase().trim() === (f.referent || '').toLowerCase().trim());
      if (ref) f.referent_id = ref.id;

      if (doublon) {
        conflits.push({ nouveau: f, existant: doublon });
      } else {
        fornecedoresSansDoublonsPush(fournisseursSansDoublons, f);
      }
    }

    function fornecedoresSansDoublonsPush(arr, item) {
      // petit helper au cas où on veut filtrer / nettoyer plus tard
      arr.push(item);
    }

    // Création tableau HTML
    let html = `
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
              <td>${f.nom}</td>
              <td>${f.contact || ''}</td>
              <td>${f.email || ''}</td>
              <td>${f.telephone || ''}</td>
              <td>${f.adresse || ''}</td>
              <td>${f.code_postal || ''}</td>
              <td>${f.ville || ''}</td>
              <td>
                <select data-index="${i}" class="select-categorie">
                  <option value="">-- Choisir --</option>
                  ${window.buildCategoryOptionsGrouped(catsDetailed, f.categorie_id || null)}
                </select>
              </td>
              <td>
                <select data-index="${i}" class="select-referent">
                  <option value="">-- Choisir --</option>
                  ${referents.map(r => `
                    <option value="${r.id}" ${f.referent_id === r.id ? 'selected' : ''}>${r.nom} ${r.prenom}</option>
                  `).join('')}
                </select>
              </td>
              <td>${f.label || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Conflits
    if (conflits.length > 0) {
      html += `
        <h3>Conflits détectés (${conflits.length})</h3>
        <table class="table-import" id="table-import-fournisseurs-conflits">
          <thead>
            <tr><th>Nom</th><th>Catégorie</th><th>Référent</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${conflits.map((c, i) => `
              <tr>
                <td>${c.nouveau.nom}</td>
                <td>
                  <select data-index="${i}" class="select-categorie-conflit">
                    <option value="">-- Choisir --</option>
                    ${window.buildCategoryOptionsGrouped(catsDetailed, c.nouveau.categorie_id || null)}
                  </select>
                </td>
                <td>
                  <select data-index="${i}" class="select-referent-conflit">
                    <option value="">-- Choisir --</option>
                    ${referents.map(r => `
                      <option value="${r.id}" ${c.nouveau.referent_id === r.id ? 'selected' : ''}>${r.nom} ${r.prenom}</option>
                    `).join('')}
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
      `;
    }

    html += `<button id="valider-import-fournisseurs" class="btn-valider" style="margin-top: 20px;">✅ Valider l'import</button>`;
    container.innerHTML = html;

    // ⛳️ IMPORTANT : câblage explicite du SearchableSelect pour les catégories
    // (on force ici, car parametres.js ignore volontairement ces conteneurs)
    const catSelects = container.querySelectorAll('select.select-categorie, select.select-categorie-conflit');
    catSelects.forEach(sel => {
      if (!sel.dataset.placeholder) sel.dataset.placeholder = 'Rechercher une catégorie…';
      window.SearchableSelect?.wire(sel); // ouvre toute la liste sur clic, 1ère frappe = efface et filtre
    });

    // Sélecteurs (sans doublons) → null si vide
    container.querySelectorAll('.select-categorie').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        fournisseursSansDoublons[index].categorie_id = v ? parseInt(v, 10) : null;
      });
    });
    container.querySelectorAll('.select-referent').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        fournisseursSansDoublons[index].referent_id = v ? parseInt(v, 10) : null;
      });
    });

    // Sélecteurs (conflits) → null si vide
    container.querySelectorAll('.select-categorie-conflit').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        conflits[index].nouveau.categorie_id = v ? parseInt(v, 10) : null;
      });
    });
    container.querySelectorAll('.select-referent-conflit').forEach(sel => {
      sel.addEventListener('change', e => {
        const index = parseInt(e.target.dataset.index, 10);
        const v = e.target.value;
        conflits[index].nouveau.referent_id = v ? parseInt(v, 10) : null;
      });
    });

    // Validation
    container.querySelector('#valider-import-fournisseurs').addEventListener('click', async () => {
      const actions = [];
      container.querySelectorAll('.select-action-conflit').forEach(sel => {
        const index = parseInt(sel.dataset.index, 10);
        const action = sel.value;
        actions.push({ ...conflits[index], action });
      });

      for (const conflit of actions) {
        const { action, nouveau, existant } = conflit;
        if (action === 'remplacer') {
          await window.electronAPI.resoudreConflitFournisseur('remplacer', nouveau, existant.id);
        } else if (action === 'ajouter') {
          fornecedoresSansDoublonsPush(fournisseursSansDoublons, nouveau);
        }
        // sinon : on ignore (conserver)
      }

      const result = await window.electronAPI.validerImportFournisseurs(fournisseursSansDoublons);
      await showAlertModal(result?.message || "Import terminé.");
      renderImportExcel();
    });
  }

  // === Export global ===
  window.PageFournisseurs = {
    chargerFournisseurs,
    ajouterFournisseur,
    modifierFournisseur,
    renderImportFournisseurs,
  };

})();
