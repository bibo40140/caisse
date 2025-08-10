const { dialog } = require('@electron/remote');



function navigate(page) {
  const title = document.getElementById("page-title");
  const content = document.getElementById("page-content");

  switch (page) {
    case 'produits':
      title.textContent = "Produits";
      renderFormulaireProduit();
      break;

    case 'caisse':
  title.textContent = "Caisse";
  renderCaisse();
  break;


    case 'receptions':
      title.textContent = "Réceptions";
renderReception();
      break;

    case 'adherents':
  title.textContent = "Adhérents";
  renderGestionAdherents();
  break;

	  
	case 'fournisseurs':
	  title.textContent = "Fournisseurs";
	  chargerFournisseurs();
	break;
	
	
	

    case 'parametres':
 title.textContent = "Paramètres";
content.innerHTML = `
 <h2>Paramètres</h2>
<ul style="display: flex; gap: 20px; list-style: none; padding-left: 0;">
  <li><button id="btn-param-import">📂 Import CSV</button></li>
  <li><button id="btn-param-categories">🗂️ Gérer les catégories</button></li>
  <li><button id="btn-param-unites">⚖️ Unités</button></li>
  <li><button id="btn-param-historique">🔧 Historique des ventes</button></li>
  <li><button id="btn-param-cotisations">🔧 Cotisations</button></li>
  <li><button id="btn-param-historiquerecetpion">🔧 historique réception</button></li>

  <li><button id="btn-param-autres">🔧 Autres paramètres</button></li>
</ul>
<div id="parametres-souspage" style="margin-top: 20px;"></div>

`;

// Gestion des sous-menus
document.getElementById('btn-param-import').addEventListener('click', () => {
  renderImportExcel();
});

document.getElementById('btn-param-categories').addEventListener('click', () => {
  renderGestionCategories();
});

document.getElementById('btn-param-unites').addEventListener('click', () => {
  renderGestionUnites();
});

document.getElementById('btn-param-historique').addEventListener('click', () => {
  renderHistoriqueFactures(); 
});

document.getElementById('btn-param-cotisations').addEventListener('click', () => {
  renderCotisations(); // 
});

document.getElementById('btn-param-historiquerecetpion').addEventListener('click', () => {
  renderReceptions(); // 
});


document.getElementById('btn-param-autres').addEventListener('click', () => {
  renderGestionParametres();
});


const exemplesEntetes = {
  categories: ["nom"],
  fournisseurs: ["nom", "email", "telephone", "adresse", "code_postal", "ville"],
  produits: ["nom", "prix", "stock", "unite", "code_barre"],
adherents: ["nom", "prenom", "email1", "email2", "telephone1", "telephone2", "adresse", "code_postal", "ville", "nb_personnes_foyer", "tranche_age"]
  };







  break;

	  
	  case 'categories':
	  title.textContent = "Catégories";
	  chargerCategories();
	  break;


    default:
      title.textContent = "Accueil";
      content.innerHTML = `<p>Bienvenue dans votre logiciel de caisse Coop'az !</p>`;
  }
}

window.navigate = navigate;

window.voirDetailsReception = async function(receptionId) {
  const content = document.getElementById("page-content");

  const reception = await window.electronAPI.getReceptionDetails(receptionId);
  if (!reception) {
    content.innerHTML = "<p>Réception introuvable.</p>";
    return;
  }

  const { date, bon_livraison, commentaire, fournisseur_nom, utilisateur, lignes } = reception;

  content.innerHTML = `
    <button class="btn-retour" onclick="renderReceptions()">← Retour</button>
    <h2>📄 Détail de la réception</h2>

    <div class="detail-section">
      <p><strong>Date :</strong> ${new Date(date).toLocaleString()}</p>
      <p><strong>Bon de livraison :</strong> ${bon_livraison}</p>
      <p><strong>Fournisseur :</strong> ${fournisseur_nom || '—'}</p>
      <p><strong>Utilisateur :</strong> ${utilisateur || '—'}</p>
      <p><strong>Commentaire :</strong> ${commentaire || '—'}</p>
    </div>

    <h3 style="margin-top:30px;">📦 Produits reçus</h3>

    <table class="reception-table">
      <thead>
        <tr>
          <th>Produit</th>
          <th>Stock corrigé</th>
          <th>Qté reçue</th>
          <th>Prix</th>
        </tr>
      </thead>
      <tbody>
        ${lignes.map(l => `
          <tr>
            <td>${l.nom}</td>
            <td>${l.stock_corrige !== null ? l.stock_corrige : '—'}</td>
            <td>${l.quantite !== null ? l.quantite : '—'}</td>
            <td>${l.prix !== null ? l.prix.toFixed(2) + ' €' : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
};


function showConfirmModal(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <p>${message}</p>
        <div class="modal-actions">
          <button id="confirm-yes">Oui</button>
          <button id="confirm-no">Non</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('confirm-yes').onclick = () => {
      modal.remove();
      resolve(true);
    };
    document.getElementById('confirm-no').onclick = () => {
      modal.remove();
      resolve(false);
    };
  });
}

function showAlertModal(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';

    // ✅ Gestion des objets pour éviter [object Object]
    let displayedMessage = '';
    if (typeof message === 'object') {
      displayedMessage = message.message || JSON.stringify(message, null, 2);
    } else {
      displayedMessage = String(message);
    }

    modal.innerHTML = `
      <div class="modal">
        <p>${displayedMessage.replace(/\n/g, '<br>')}</p>
        <div class="modal-actions">
          <button id="alert-ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('alert-ok').onclick = () => {
      modal.remove();
      resolve();
    };
  });
}

function showFormModal(titre, formElement) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <h3>${titre}</h3>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button id="form-ok">✅ Valider</button>
          <button id="form-cancel">Annuler</button>
        </div>
      </div>
    `;
    modal.querySelector('.modal-body').appendChild(formElement);
    document.body.appendChild(modal);

    document.getElementById('form-ok').onclick = () => {
      modal.remove();
      resolve(true);
    };
    document.getElementById('form-cancel').onclick = () => {
      modal.remove();
      resolve(false);
    };
  });
}

window.fermerPopupFacture = () => {
  document.getElementById('facture-popup').style.display = 'none';
}



async function showPromptModal(message, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    overlay.innerHTML = `
      <div class="modal">
        <p>${message.replace(/\n/g, "<br>")}</p>
        <input type="number" id="modal-prompt-input" min="5" step="0.01" value="${defaultValue}" style="margin: 10px 0; padding: 8px; width: 100%;">
        <div class="modal-actions">
          <button id="modal-prompt-ok">OK</button>
          <button id="modal-prompt-cancel">Annuler</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("modal-prompt-input").focus();

    document.getElementById("modal-prompt-ok").addEventListener("click", () => {
      const val = document.getElementById("modal-prompt-input").value;
      overlay.remove();
      resolve(val);
    });

    document.getElementById("modal-prompt-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
  });
}




// ✅ Fonction d'affichage du formulaire pour les produits
async function renderFormulaireProduit() {
  const fournisseurs = await window.electronAPI.getFournisseurs();
  const content = document.getElementById('page-content');
  const options = fournisseurs.map(f => `<option value="${f.id}">${f.nom}</option>`).join('');
  
  // Correspondance automatique du fournisseur par nom (insensible à la casse)



console.log("Fournisseurs reçus :", fournisseurs);

  content.innerHTML = `
    <h3>Ajouter un produit</h3>
    <form id="form-produit">
  <label>Nom du produit : <input name="nom" required></label><br><br>
  <label>Prix (€) : <input name="prix" type="number" step="0.01" required></label><br><br>
  <label>Stock : <input name="stock" type="number" required></label><br><br>
  <label>Unité : <input name="unite" required></label><br><br>
  <label>Code-barre : <input name="code_barre" required></label><br><br>
  <label>Fournisseur :
    <select name="fournisseur_id" required>
      <option value="">-- Choisir un fournisseur --</option>
      ${options}
    </select>
  </label><br><br>
  <button type="submit">Ajouter</button>
</form>

    <hr>
    <div id="produits-liste"></div>
  `;

 document.getElementById('form-produit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const produit = {
    nom: form.nom.value.trim(),
    prix: parseFloat(form.prix.value),
    stock: parseInt(form.stock.value),
    fournisseur_id: parseInt(form.fournisseur_id.value),
    unite: form.unite.value.trim(),
    code_barre: form.code_barre.value.trim()
  };

  // Vérifie si un produit existe déjà
  const existant = await window.electronAPI.rechercherProduitParNomEtFournisseur(produit.nom, produit.fournisseur_id);

  if (existant) {
    const choix = await showChoixModal(`
      ⚠️ Un produit nommé <strong>${existant.nom}</strong> existe déjà pour ce fournisseur (${existant.fournisseur_nom}).<br><br>
      Que souhaitez-vous faire ?
    `, ['Remplacer', 'Ajouter quand même', 'Annuler']);

    if (choix === 'Annuler') return;

    if (choix === 'Remplacer') {
      produit.id = existant.id;
      await window.electronAPI.modifierProduit(produit);
      await showAlertModal("🔁 Produit remplacé !");
      form.reset();
      await chargerProduits();
      return;
    }
    // Sinon on continue
  }

  const result = await window.electronAPI.ajouterProduit(produit);
  await showAlertModal(`✅ Produit ajouté avec la référence : ${result.reference}`);
  form.reset();
  await chargerProduits();
});

  await chargerProduits();
}

// ✅ Fonction d'affichage des produits en table
async function chargerProduits() {
  const produits = await window.electronAPI.getProduits();
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
          <th>Stock</th>
          <th>Code-barre</th>
          <th>Unité</th>
          <th>Fournisseur</th>
		  <th>Catégorie</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="table-produits-body">
        ${produits.map(p => `
          <tr data-id="${p.id}">
            <td>${p.nom}</td>
            <td>${p.reference || '—'}</td>
            <td>${p.prix.toFixed(2)} €</td>
            <td>${p.stock}</td>
            <td>${p.code_barre || '—'}</td>
            <td>${p.unite || '—'}</td>
            <td>${p.fournisseur_nom || '—'}</td>
			<td>${p.categorie_nom || '—'}</td> 
            <td>
              <button class="btn-edit-produit" data-id="${p.id}">✏️</button>
              <button class="btn-delete-produit" data-id="${p.id}">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 🔍 Filtre de recherche
  const filtreInput = document.getElementById('filtre-produit');
  filtreInput.addEventListener('input', () => {
    const filtre = filtreInput.value.toLowerCase();
    const lignes = document.querySelectorAll('#table-produits-body tr');
    lignes.forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(filtre) ? '' : 'none';
    });
  });

  // ✏️ Modifier
  document.querySelectorAll('.btn-edit-produit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      const produits = await window.electronAPI.getProduits();
      const fournisseurs = await window.electronAPI.getFournisseurs();
	  const unites = await window.electronAPI.getUnites();

      const produit = produits.find(p => p.id === id);
      if (!produit) return;

      const content = document.getElementById('page-content');
      content.innerHTML = `
        <h3>Modifier un produit</h3>
        <form id="form-modif-produit">
          <input type="hidden" name="id" value="${produit.id}">
          <label>Nom : <input name="nom" value="${produit.nom}" required></label><br><br>
          <label>Prix (€) : <input type="number" name="prix" step="0.01" value="${produit.prix}" required></label><br><br>
          <label>Stock : <input type="number" name="stock" value="${produit.stock}" required></label><br><br>
<label>Unité :
  <select name="unite" required>
    <option value="">-- Choisir une unité --</option>
    ${unites.map(u => `
      <option value="${u.nom}" ${u.nom === produit.unite ? 'selected' : ''}>${u.nom}</option>
    `).join('')}
  </select>
</label><br><br>
          <label>Code-barre : <input name="code_barre" value="${produit.code_barre || ''}"></label><br><br>
          <label>Fournisseur :
            <select name="fournisseur_id">
              <option value="">-- Aucun --</option>
              ${fournisseurs.map(f => `
                <option value="${f.id}" ${f.id === produit.fournisseur_id ? 'selected' : ''}>${f.nom}</option>
              `).join('')}
            </select>
          </label><br><br>
          <button type="submit">💾 Enregistrer</button>
          <button type="button" id="btn-annuler">Annuler</button>
        </form>
      `;

      document.getElementById('btn-annuler').addEventListener('click', () => {
        renderFormulaireProduit();
      });

      document.getElementById('form-modif-produit').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;

        const modif = {
          id: parseInt(form.id.value),
          nom: form.nom.value,
          prix: parseFloat(form.prix.value),
          stock: parseInt(form.stock.value),
          unite: form.unite.value,
          code_barre: form.code_barre.value,
          fournisseur_id: form.fournisseur_id.value ? parseInt(form.fournisseur_id.value) : null
        };

        await window.electronAPI.modifierProduit(modif);
        await showAlertModal("✅ Produit modifié !");
        renderFormulaireProduit();
      });
    });
  });

  // 🗑️ Supprimer
  document.querySelectorAll('.btn-delete-produit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      const confirm = await showConfirmModal("Voulez-vous supprimer ce produit ?");
      if (!confirm) return;
      await window.electronAPI.supprimerProduit(id);
      await showAlertModal("🗑️ Produit supprimé !");
      await chargerProduits();
    });
  });
}
async function chargerFournisseurs() {
  const fournisseurs = await window.electronAPI.getFournisseurs();
  const content = document.getElementById("page-content");

  content.innerHTML = `
    <h2>Liste des fournisseurs</h2>
    <input type="text" id="filtre-fournisseur" placeholder="🔍 Rechercher un fournisseur..." style="width: 300px; padding: 5px;">
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
            <td><button data-id="${f.id}" class="btn-modifier">✏️ Modifier</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // 🔍 Filtre de recherche
  document.getElementById('filtre-fournisseur').addEventListener('input', () => {
    const texte = document.getElementById('filtre-fournisseur').value.toLowerCase();
    const lignes = document.querySelectorAll('#fournisseurs-liste tr');
    lignes.forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(texte) ? '' : 'none';
    });
  });

  // ➕ Bouton Ajouter
  document.getElementById('btn-ajouter-fournisseur').addEventListener('click', async () => {
    const categories = await window.electronAPI.getCategories();
    const adherents = await window.electronAPI.getAdherents();

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
          ${adherents.map(a => `<option value="${a.id}">${a.nom} ${a.prenom}</option>`).join('')}
        </select>
      </label><br><br>
      <label>Catégorie :
        <select name="categorie_id">
          <option value="">-- Aucune --</option>
          ${categories.map(c => `<option value="${c.id}">${c.nom}</option>`).join('')}
        </select>
      </label><br><br>
      <label>Label : <input name="label"></label><br><br>
    `;

    const confirm = await showFormModal("Ajouter un fournisseur", form);
    if (!confirm) return;

    const data = {
      nom: form.nom.value.trim(),
      contact: form.contact.value.trim(),
      email: form.email.value.trim(),
      telephone: form.telephone.value.trim(),
      adresse: form.adresse.value.trim(),
      code_postal: form.code_postal.value.trim(),
      ville: form.ville.value.trim(),
      referent_id: form.referent_id.value ? parseInt(form.referent_id.value) : null,
      categorie_id: form.categorie_id.value ? parseInt(form.categorie_id.value) : null,
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

  // ✏️ Modifier un fournisseur
  document.querySelectorAll('.btn-modifier').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const fournisseur = fournisseurs.find(f => f.id == id);
      const categories = await window.electronAPI.getCategories();
      const adherents = await window.electronAPI.getAdherents();

      const content = document.getElementById("page-content");
      content.innerHTML = `
        <h3>Modifier le fournisseur</h3>
        <form id="form-edit-fournisseur">
          <input type="hidden" name="id" value="${fournisseur.id}">
          <label>Nom : <input name="nom" value="${fournisseur.nom}" required></label><br><br>
          <label>Email : <input name="email" value="${fournisseur.email || ''}"></label><br><br>
          <label>Téléphone : <input name="telephone" value="${fournisseur.telephone || ''}"></label><br><br>
          <label>Adresse : <input name="adresse" value="${fournisseur.adresse || ''}"></label><br><br>
          <label>Code postal : <input name="code_postal" value="${fournisseur.code_postal || ''}"></label><br><br>
          <label>Ville : <input name="ville" value="${fournisseur.ville || ''}"></label><br><br>
          <label>Catégorie :
            <select name="categorie_id">
              <option value="">-- Aucune --</option>
              ${categories.map(c => `
                <option value="${c.id}" ${fournisseur.categorie_id == c.id ? 'selected' : ''}>${c.nom}</option>
              `).join('')}
            </select>
          </label><br><br>
          <label>Référent :
            <select name="referent_id">
              <option value="">-- Aucun --</option>
              ${adherents.map(a => `
                <option value="${a.id}" ${fournisseur.referent === `${a.prenom} ${a.nom}` ? 'selected' : ''}>${a.nom} ${a.prenom}</option>
              `).join('')}
            </select>
          </label><br><br>
          <label>Label : <input name="label" value="${fournisseur.label || ''}"></label><br><br>
          <button type="submit" id="btn-save">💾 Enregistrer</button>
          <button type="button" id="btn-cancel">Annuler</button>
        </form>
      `;

      document.getElementById("form-edit-fournisseur").addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const modif = {
          id: parseInt(form.id.value),
          nom: form.nom.value,
          email: form.email.value,
          telephone: form.telephone.value,
          adresse: form.adresse.value,
          code_postal: form.code_postal.value,
          ville: form.ville.value,
          categorie_id: form.categorie_id.value ? parseInt(form.categorie_id.value) : null,
          referent_id: form.referent_id.value ? parseInt(form.referent_id.value) : null,
          label: form.label.value
        };
        await window.electronAPI.modifierFournisseur(modif);
        await showAlertModal("✅ Fournisseur modifié !");
        chargerFournisseurs();
      });

      document.getElementById("btn-cancel").addEventListener('click', chargerFournisseurs);
    });
  });
}







async function ajouterFournisseur() {
  const categories = await window.electronAPI.getCategories();
  const options = categories.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');

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
        <select name="categorie_id">
          <option value="">-- Choisir une catégorie --</option>
          ${options}
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
async function chargerCategories() {
  const categories = await window.electronAPI.getCategories();
  const content = document.getElementById('page-content');

  content.innerHTML = `
    <h2>Liste des catégories</h2>

    <form id="form-categorie" style="margin-bottom: 15px;">
      <input type="text" name="nom" placeholder="Nom de la catégorie" required style="padding: 6px;">
      <button type="submit">➕ Ajouter</button>
    </form>

    <table border="1" cellpadding="5" style="width: 100%; border-collapse: collapse;">
      <thead style="background-color: #f0f0f0;">
        <tr><th>ID</th><th>Nom</th></tr>
      </thead>
      <tbody>
        ${categories.map(c => `
          <tr>
            <td>${c.id}</td>
            <td>${c.nom}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('form-categorie').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const nom = form.nom.value.trim();
    if (nom.length === 0) return;

    await window.electronAPI.ajouterCategorie(nom);
    form.reset();
    await chargerCategories(); // recharge
  });
}





async function importerCSV() {
  const confirmation = confirm("Importer les données depuis les fichiers CSV ? Cela peut écraser des données existantes.");
  if (!confirmation) return;

  try {
    const result = await window.electronAPI.importerDepuisCSV();
    alert(result);
  } catch (err) {
    console.error(err);
    await showAlertModal("Erreur lors de l'importation des CSV");
  }
}

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
  "date_inscription", "date_archivage", "date_reactivation"  // ← AJOUT
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

    <!-- PRODUITS -->
    <div class="import-block">
      <h3>🛒 Produits</h3>
      <p>
        📥 <a href="${fichiersModele.produits}" download target="_blank">
          Télécharger le modèle Excel
        </a>
      </p>
      <p>Colonnes attendues :</p>
      <ul>${exemplesEntetes.produits.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
      <button class="btn-import" onclick="importerExcel('produits')">📂 Choisir un fichier Excel</button>
      <div id="produits-import-result" class="import-result"></div>
    </div>

    <!-- FOURNISSEURS -->
    <div class="import-block">
      <h3>🚚 Fournisseurs</h3>
      <p>
        📥 <a href="${fichiersModele.fournisseurs}" download target="_blank">
          Télécharger le modèle Excel
        </a>
      </p>
      <p>Colonnes attendues :</p>
      <ul>${exemplesEntetes.fournisseurs.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
      <button class="btn-import" onclick="importerExcel('fournisseurs')">📂 Choisir un fichier Excel</button>
      <div id="fournisseurs-import-result" class="import-result"></div>
    </div>

    <!-- ADHÉRENTS -->
    <div class="import-block">
      <h3>👥 Adhérents</h3>
      <p>
        📥 <a href="${fichiersModele.adherents}" download target="_blank">
          Télécharger le modèle Excel
        </a>
      </p>
      <p>Colonnes attendues :</p>
      <ul>${exemplesEntetes.adherents.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
      <button class="btn-import" onclick="importerExcel('adherents')">📂 Choisir un fichier Excel</button>
      <div id="adherents-import-result" class="import-result"></div>
    </div>

    <!-- CATÉGORIES -->
    <div class="import-block">
      <h3>🗂️ Catégories</h3>
      <p>
        📥 <a href="${fichiersModele.categories}" download target="_blank">
          Télécharger le modèle Excel
        </a>
      </p>
      <p>Colonnes attendues :</p>
      <ul>${exemplesEntetes.categories.map(col => `<li><strong>${col}</strong></li>`).join('')}</ul>
      <button class="btn-import" onclick="importerExcel('categories')">📂 Choisir un fichier Excel</button>
      <div id="categories-import-result" class="import-result"></div>
    </div>

  </div>
`;

}


// exemple :
async function importerExcel(type) {
  if (type === 'fournisseurs') {
    const result = await window.electronAPI.analyserImportFournisseurs();
    renderImportFournisseurs(result);
    return; // ← important pour ne pas exécuter le code en dessous
  }
  if (type === 'produits') {
  await renderImportProduits(); // 👈 comme pour fournisseurs
  return;
}
if (type === 'adherents') {
  await renderImportAdherents();
  return;
}



  // autres types restent inchangés
  const result = await window.electronAPI.importerExcel(type);
  await showAlertModal(result);
}


async function renderImportProduits() {
  const container = document.getElementById('parametres-souspage');

  const filePath = await window.electronAPI.choisirFichier();
  if (!filePath) {
    container.innerHTML = `<p>Aucun fichier sélectionné.</p>`;
    return;
  }

  container.innerHTML = `<p>Chargement du fichier...</p>`;

  const data = await window.electronAPI.analyserImportProduits(filePath);
  if (!data || data.status !== 'ok') {
    container.innerHTML = `<p>Erreur lors de l'import du fichier.</p>`;
    return;
  }

  const { produits, unitesConnues, fournisseurs } = data;

  container.innerHTML = `
    <h3>Prévisualisation des produits importés</h3>
    <table class="table-import">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Prix</th>
          <th>Stock</th>
          <th>Code barre</th>
          <th>Unité</th>
          <th>Fournisseur</th>
        </tr>
      </thead>
      <tbody>
        ${produits.map((p, i) => `
          <tr>
            <td>${p.nom}</td>
            <td>${p.prix}</td>
            <td>${p.stock}</td>
            <td>${p.code_barre}</td>
            <td>
              <select data-index="${i}" class="select-unite">
                <option value="">-- Choisir --</option>
                ${unitesConnues.map(u => `
                  <option value="${u.nom}" ${p.unite_valide === u.nom ? 'selected' : ''}>${u.nom}</option>
                `).join('')}
              </select>
            </td>
            <td>
              <select data-index="${i}" class="select-fournisseur">
                <option value="">-- Choisir --</option>
                ${fournisseurs.map(f => `
                  <option value="${f.id}" ${f.nom === p.fournisseur ? 'selected' : ''}>${f.nom}</option>
                `).join('')}
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <button class="btn-valider" id="valider-import-produits" style="margin-top: 20px;">
      ✅ Valider l'import
    </button>

    <div id="result-import-produits" style="margin-top: 30px;"></div>
  `;

  document.querySelectorAll('.select-unite').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      produits[index].unite = e.target.value;
    });
  });

  document.querySelectorAll('.select-fournisseur').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      produits[index].fournisseur_id = parseInt(e.target.value);
    });
  });

  document.getElementById('valider-import-produits').addEventListener('click', async () => {
    const confirm = await showConfirmModal(`Confirmer l'import de ${produits.length} produit(s) ?`);
    if (!confirm) return;

    const resultat = await window.electronAPI.validerImportProduits(produits);
    const resultDiv = document.getElementById('result-import-produits');
    resultDiv.innerHTML = '';

    if (resultat.status === 'ok') {
      await showAlertModal("✅ Import terminé !");
      renderImportExcel();
      return;
    }

    if (resultat.status === 'partiel') {
      const modifications = resultat.modifications || [];

      const table = document.createElement('table');
      table.classList.add('table-import');
      table.innerHTML = `
        <thead>
          <tr>
            <th>Produit existant</th>
            <th>Fournisseur</th>
            <th>Produit importé</th>
            <th>Fournisseur</th>
            <th>Unité</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${modifications.map((modif, index) => `
            <tr>
              <td>${modif.existant.nom}</td>
              <td>${modif.existant.fournisseur_nom}</td>
              <td>${modif.nouveau.nom}</td>
              <td>${modif.nouveau.fournisseur_nom}</td>
              <td>
                <select data-index="${index}" class="select-unite-conflit">
                  <option value="">-- Choisir --</option>
                  ${unitesConnues.map(u => `
                    <option value="${u.nom}" ${modif.nouveau.unite === u.nom ? 'selected' : ''}>${u.nom}</option>
                  `).join('')}
                </select>
              </td>
              <td>
                <select data-index="${index}" class="select-action-produit">
                  <option value="remplacer">♻️ Remplacer</option>
                  <option value="ajouter">➕ Ajouter</option>
                  <option value="ignorer">❌ Ignorer</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      `;
      resultDiv.appendChild(table);

      // Sélecteurs d’unité
      document.querySelectorAll('.select-unite-conflit').forEach(sel => {
        sel.addEventListener('change', e => {
          const index = parseInt(e.target.dataset.index);
          modifications[index].nouveau.unite = e.target.value;
        });
      });

      const validerBtn = document.createElement('button');
      validerBtn.classList.add('btn-valider');
      validerBtn.textContent = '✅ Appliquer les actions';
      validerBtn.style.marginTop = '20px';

      validerBtn.addEventListener('click', async () => {
        const actions = Array.from(document.querySelectorAll('.select-action-produit')).map(select => select.value);

        for (let i = 0; i < modifications.length; i++) {
          const action = actions[i];
          const modif = modifications[i];

          // Récupération de l’unité
          const uniteNom = modif.nouveau.unite || '';
          const unite = unitesConnues.find(u => u.nom.toLowerCase() === uniteNom.toLowerCase());
          if (unite) {
            modif.nouveau.unite_id = unite.id;
          }

          // Vérif fournisseur
          modif.nouveau.fournisseur_id = parseInt(modif.nouveau.fournisseur_id || 0);

          if (action === 'remplacer') {
            await window.electronAPI.resoudreConflitProduit('remplacer', modif.nouveau, modif.idExistant);
          } else if (action === 'ajouter') {
            await window.electronAPI.resoudreConflitProduit('ajouter', modif.nouveau);
          }
        }

        await showAlertModal("✅ Conflits résolus, import terminé !");
        renderImportExcel();
      });

      resultDiv.appendChild(validerBtn);
    }
  });
}





async function showChoixModal(message, options) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <p>${message}</p>
        <div class="modal-actions">
          ${options.map(opt => `<button>${opt}</button>`).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const choix = btn.textContent;
        modal.remove();
        resolve(choix);
      });
    });
  });
}
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

  const { fournisseurs, categories, referents } = data;
  const existants = await window.electronAPI.getFournisseurs();

  const fournisseursSansDoublons = [];
  const conflits = [];

  for (const f of fournisseurs) {
    const doublon = existants.find(e => e.nom.toLowerCase() === f.nom.toLowerCase());
    
    // Détection catégorie existante
    const cat = categories.find(c => c.nom.toLowerCase() === (f.categorie_nom || '').toLowerCase());
    if (cat) f.categorie_id = cat.id;

    // Détection référent existant
    const ref = referents.find(r => (`${r.nom} ${r.prenom}`).toLowerCase().trim() === (f.referent || '').toLowerCase().trim());
    if (ref) f.referent_id = ref.id;

    if (doublon) {
      conflits.push({ nouveau: f, existant: doublon });
    } else {
      fournisseursSansDoublons.push(f);
    }
  }

  // Création tableau HTML
  let html = `
    <h3>Fournisseurs à importer (${fournisseursSansDoublons.length})</h3>
    <table class="table-import">
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
                ${categories.map(c => `
                  <option value="${c.id}" ${f.categorie_id === c.id ? 'selected' : ''}>${c.nom}</option>
                `).join('')}
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
      <table class="table-import">
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
                  ${categories.map(cat => `
                    <option value="${cat.id}" ${c.nouveau.categorie_id === cat.id ? 'selected' : ''}>${cat.nom}</option>
                  `).join('')}
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

  // Sélecteurs pour les fournisseurs sans conflit
  document.querySelectorAll('.select-categorie').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      fournisseursSansDoublons[index].categorie_id = parseInt(e.target.value);
    });
  });
  document.querySelectorAll('.select-referent').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      fournisseursSansDoublons[index].referent_id = parseInt(e.target.value);
    });
  });

  // Sélecteurs pour les conflits
  document.querySelectorAll('.select-categorie-conflit').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      conflits[index].nouveau.categorie_id = parseInt(e.target.value);
    });
  });
  document.querySelectorAll('.select-referent-conflit').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      conflits[index].nouveau.referent_id = parseInt(e.target.value);
    });
  });

  // Validation
  document.getElementById('valider-import-fournisseurs').addEventListener('click', async () => {
    const actions = [];

    document.querySelectorAll('.select-action-conflit').forEach(sel => {
      const index = parseInt(sel.dataset.index);
      const action = sel.value;
      actions.push({ ...conflits[index], action });
    });

    for (const conflit of actions) {
      const { action, nouveau, existant } = conflit;
      if (action === 'remplacer') {
        await window.electronAPI.resoudreConflitFournisseur('remplacer', nouveau, existant.id);
      } else if (action === 'ajouter') {
        fournisseursSansDoublons.push(nouveau);
      }
      // sinon : on ignore
    }

    const result = await window.electronAPI.validerImportFournisseurs(fournisseursSansDoublons);
    await showAlertModal(result?.message || "Import terminé.");
    renderImportExcel();
  });
}





document.getElementById('btn-import-fournisseurs').addEventListener('click', async () => {
  await renderImportFournisseurs(); // ⬅️ remplace l’ancien appel direct à importerCSV
});



// -----------------------------------------------------------------------------
//  Cactégories
// -----------------------------------------------------------------------------



async function renderGestionCategories() {
  const container = document.getElementById('parametres-souspage');
  const categories = await window.electronAPI.getCategories();

  container.innerHTML = `
    <h3>Gestion des catégories</h3>
    <form id="form-categorie">
      <input name="nom" placeholder="Nouvelle catégorie" required style="padding: 5px;">
      <button type="submit">➕ Ajouter</button>
    </form>
    <br>
    <table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <thead>
        <tr><th>Nom</th><th>Action</th></tr>
      </thead>
      <tbody id="liste-categories">
        ${categories.map(c => `
          <tr data-id="${c.id}">
            <td>
              <span class="nom-categorie">${c.nom}</span>
              <input type="text" class="edit-categorie" value="${c.nom}" style="display:none; width: 100%;">
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

  // Ajouter une catégorie
  document.getElementById('form-categorie').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = e.target.nom.value.trim();
    if (nom.length === 0) return;
    await window.electronAPI.ajouterCategorie(nom);
    renderGestionCategories();
  });

  // Modifier une catégorie
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      row.querySelector('.nom-categorie').style.display = 'none';
      row.querySelector('.edit-categorie').style.display = 'inline-block';
      row.querySelector('.btn-edit').style.display = 'none';
      row.querySelector('.btn-save').style.display = 'inline-block';
    });
  });

  document.querySelectorAll('.btn-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const id = row.dataset.id;
      const newName = row.querySelector('.edit-categorie').value.trim();
      if (newName.length === 0) return;
      await window.electronAPI.modifierCategorie(parseInt(id), newName);
      renderGestionCategories();
    });
  });

  // Supprimer une catégorie avec confirmation et message si bloqué
  document.querySelectorAll('.btn-supprimer').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const id = parseInt(row.dataset.id);

      const confirm = await showConfirmModal("Souhaitez-vous vraiment supprimer cette catégorie ?");
      if (!confirm) return;

      const result = await window.electronAPI.supprimerCategorie(id);

      if (result === true) {
        await showAlertModal("Catégorie supprimée avec succès.");
        renderGestionCategories();
      } else {
        await showAlertModal(result); // Affiche la liste des fournisseurs bloquants
      }
    });
  });
}




// -----------------------------------------------------------------------------
//  Unités
// -----------------------------------------------------------------------------


// Ajout d'un sous-menu "Unités" dans les paramètres
// Ce code s'insère dans renderer.js (ou fichier JS principal de gestion UI)
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

  // Ajouter
  document.getElementById('form-unite').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = e.target.nom.value.trim();
    if (nom.length === 0) return;
    await window.electronAPI.ajouterUnite(nom);
    renderGestionUnites();
  });

  // Modifier
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

  // Supprimer
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



// -----------------------------------------------------------------------------
//  Caisse
// -----------------------------------------------------------------------------
async function renderCaisse() {
  const content = document.getElementById('page-content');
  const produits = await window.electronAPI.getProduits();
  const categories = await window.electronAPI.getCategories();
  const adherents = await window.electronAPI.getAdherents(); // ⚠️ Doit exister côté backend

  let categorieActive = null;
let panier = [];

let adherentSelectionneId = localStorage.getItem("adherentId") || "";


try {
  const panierStocke = localStorage.getItem('panier');
  if (panierStocke) panier = JSON.parse(panierStocke);
} catch (e) {
  console.error("Erreur lors du chargement du panier depuis le localStorage", e);
}
  let produitEnCours = null;
  
  const sauvegarderPanier = () => {
  try {
    localStorage.setItem('panier', JSON.stringify(panier));
  } catch (e) {
    console.error("Erreur lors de l'enregistrement du panier", e);
  }
};


const filtrerProduits = () => {
  const filtre = document.getElementById('search-produit').value.toLowerCase().trim();

  // Si recherche active, on ignore catégorie et stock
  if (filtre.length > 0) {
    return produits.filter(p =>
      p.nom.toLowerCase().includes(filtre) ||
      (p.code_barre && p.code_barre.toLowerCase().includes(filtre))
    );
  }

  // Sinon, comportement normal : filtrage par catégorie ET stock > 0
  return produits.filter(p => {
    const matchCat = !categorieActive || p.categorie_nom === categorieActive;
    return matchCat && p.stock > 0;
  });
};

const ajouterAuPanier = (produit, quantite = 1) => {
  const existant = panier.find(p => p.id === produit.id);
  if (existant) {
    existant.quantite += quantite;
  } else {
    panier.push({ ...produit, quantite });
  }

  afficherPanier();
  sauvegarderPanier();

  
// 🎯 Appliquer animation visuelle sur la ligne du dernier produit ajouté
setTimeout(() => {
  const index = panier.findIndex(p => p.id === produit.id);
  const ligne = document.querySelector(`#panier-liste tr[data-index="${index}"]`);
  if (ligne) {
    ligne.classList.add("ligne-ajoutee");
    setTimeout(() => ligne.classList.remove("ligne-ajoutee"), 400);
  }
}, 50);

  // 🧼 Réinitialiser et re-focus le champ de recherche
  const search = document.getElementById("search-produit");
  if (search) {
    search.value = "";
    search.focus();
    afficherProduits(); // 🔄 recharge la liste des produits
  }
};


 const ouvrirPopupQuantite = (produit) => {
  produitEnCours = produit;

  // Produit en majuscules + producteur
  const nomMaj = produit.nom.toUpperCase();
  const fournisseur = produit.fournisseur_nom || "—";

  const nomElem = document.getElementById("popup-produit-nom");
  nomElem.innerHTML = `
    <div style="font-size: 1.2em; font-weight: bold;">${nomMaj}</div>
    <div style="font-size: 0.8em; color: #666;"> ${fournisseur}</div>
  `;

  document.getElementById("quantite-input").value = "";
  document.getElementById("popup-quantite").style.display = "flex";
  document.getElementById("quantite-input").focus();
};


  const fermerPopup = () => {
    document.getElementById("popup-quantite").style.display = "none";
    produitEnCours = null;
  };

  const afficherProduits = () => {
    const zoneProduits = document.getElementById('produits-zone');
    const visibles = filtrerProduits();
    zoneProduits.innerHTML = visibles.map(p => `
      <div class="produit-card" onclick="ajouterAuPanierDepuisUI(${p.id})">
        <strong>${p.nom}</strong>
        <div>${p.prix.toFixed(2)} €</div>
        <div class="unite">${p.unite}</div>
        <div class="fournisseur">${p.fournisseur_nom || '—'}</div>
      </div>
    `).join('');
  };

  const afficherPanier = () => {
  const div = document.getElementById('panier-zone');
  const total = panier.reduce((s, p) => s + p.prix * p.quantite, 0);

  // Créer la tooltip globale une seule fois
  if (!document.getElementById('tooltip-global')) {
    const tip = document.createElement('div');
    tip.id = 'tooltip-global';
    tip.style.position = 'absolute';
    tip.style.display = 'none';
    tip.style.zIndex = 99999;
    tip.style.background = 'black';
    tip.style.color = 'white';
    tip.style.padding = '6px 10px';
    tip.style.borderRadius = '5px';
    tip.style.fontSize = '0.85em';
    tip.style.maxWidth = '300px';
    tip.style.pointerEvents = 'none';
    tip.style.whiteSpace = 'normal';
    tip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    document.body.appendChild(tip);
  }

  div.innerHTML = `
    <div id="panier-header">🧺 Panier</div>
    <div id="panier-liste">
      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th>Fournisseur</th>
            <th>Unité</th>
            <th>PU</th>
            <th>Qté</th>
            <th>Total</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${panier.map((p, i) => {
            const nomProduit = (p.nom || "").replace(/"/g, '&quot;');
            return `
              <tr data-index="${i}">
                <td class="cell-produit" data-tooltip="${nomProduit}">${p.nom}</td>
                <td>${p.fournisseur_nom || '—'}</td>
                <td>${p.unite || '—'}</td>
                <td>${p.prix.toFixed(2)} €</td>
                <td>
                  <input
                    type="number"
                    min="${p.unite?.toLowerCase() === 'pièce' ? 1 : 0.01}"
                    step="${p.unite?.toLowerCase() === 'pièce' ? 1 : 0.01}"
                    class="input-quantite"
                    data-index="${i}"
                    value="${p.quantite}"
                  >
                </td>
                <td>${(p.prix * p.quantite).toFixed(2)} €</td>
                <td><button class="btn-supprimer-produit" data-index="${i}">🗑️</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div id="panier-total">Total : ${total.toFixed(2)} €</div>
    <div id="validation-zone" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
      <label for="adherent-select" style="font-weight: bold;">👤 Adhérent :</label>
      <select id="adherent-select" style="padding: 8px;">
        <option value="">-- Sélectionner un adhérent --</option>
        ${adherents.map(a => `<option value="${a.id}" data-email="${a.email}">${a.nom} ${a.prenom}</option>`).join('')}
      </select>

      <div style="display: flex; justify-content: space-between; gap: 10px;">
        <button class="btn-valider" onclick="validerVente()" style="padding: 10px; font-weight: bold; flex: 1;">
          ✅ Valider la vente
        </button>
        <button class="btn-reset-panier" onclick="viderPanier()" style="padding: 10px; background: #eee; color: #444;">
          🧹 Vider
        </button>
      </div>
    </div>
  `;

  // 🔁 Réappliquer la sélection de l’adhérent
  const select = document.getElementById('adherent-select');
  if (select && adherentSelectionneId) select.value = adherentSelectionneId;

  // 🎯 TOOLTIP
  const tooltip = document.getElementById('tooltip-global');
  document.querySelectorAll('.cell-produit').forEach(cell => {
    cell.addEventListener('mouseenter', () => {
      tooltip.innerText = cell.dataset.tooltip;
      tooltip.style.display = 'block';
    });
    cell.addEventListener('mousemove', e => {
      tooltip.style.top = `${e.pageY - 35}px`;
      tooltip.style.left = `${e.pageX + 10}px`;
    });
    cell.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });

  // 🔁 Quantité
  document.querySelectorAll('.input-quantite').forEach(input => {
    input.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.index);
      const qte = parseFloat(e.target.value);
      if (!isNaN(qte) && qte > 0) {
        panier[i].quantite = qte;
        afficherPanier();
        sauvegarderPanier();
        document.getElementById("search-produit")?.focus();
      }
    });
  });

  // ⛔ Saisie décimale interdite pour "pièce"
  document.querySelectorAll('.input-quantite').forEach(input => {
    const i = parseInt(input.dataset.index);
    const unite = panier[i]?.unite?.toLowerCase();
    if (unite === 'pièce') {
      input.addEventListener('keydown', (e) => {
        if (e.key === '.' || e.key === ',' || e.key === 'Decimal') {
          e.preventDefault();
        }
      });
      input.addEventListener('input', (e) => {
        const intVal = e.target.value.replace(/[^\d]/g, '');
        e.target.value = intVal;
      });
    }
  });

  // 🗑️ Suppression produit
  document.querySelectorAll('.btn-supprimer-produit').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.index);
      panier.splice(i, 1);
      afficherPanier();
      sauvegarderPanier();
      document.getElementById("search-produit")?.focus();
    });
  });

  // 🎯 Sélection adhérent
  const selectAdherent = document.getElementById('adherent-select');
  if (selectAdherent) {
    selectAdherent.addEventListener('change', async (e) => {
      const selectedOption = selectAdherent.options[selectAdherent.selectedIndex];
      const adherentId = selectedOption.value;
      adherentSelectionneId = adherentId;
      localStorage.setItem("adherentId", adherentId);

      const nomComplet = selectedOption.textContent;
      if (!adherentId) return;

      const dejaCotisation = panier.some(p => p.type === 'cotisation');
      if (!dejaCotisation) {
        await verifierCotisationAdherent(adherentId, nomComplet, panier, afficherPanier);
      }

      document.getElementById("search-produit")?.focus();
    });
  }
};

;



  // 🔁 Valider la vente
  
  
window.validerVente = async () => {
  const select = document.getElementById('adherent-select');
  const adherentId = select.value;
  const adherentEmail = select.options[select.selectedIndex]?.dataset.email;

  if (!adherentId || !adherentEmail) {
    alert("Merci de sélectionner un adhérent.");
    return;
  }

  if (panier.length === 0) {
    alert("Panier vide !");
    return;
  }

  const total = panier.reduce((s, p) => s + p.prix * p.quantite, 0);

  try {
    // ✅ ENREGISTRER LA VENTE EN BASE
await window.electronAPI.enregistrerVente({
  total,
  //paiement,
      adherent_id: adherentId,
cotisation: panier.find(p => p.type === 'cotisation')?.prix || 0,
  lignes: panier.map(p => ({
    produit_id: p.id,
    quantite: p.quantite,
    prix: p.prix_unitaire
  }))
});





    // ✅ EMAIL ET STOCK APRÈS ENREGISTREMENT
   const lignesProduits = panier.filter(p => p.type !== 'cotisation');
const lignesCotisation = panier.filter(p => p.type === 'cotisation');
console.log("📧 Envoi email à :", adherentEmail);

await window.electronAPI.envoyerFactureEmail({
  email: adherentEmail,
  lignes: lignesProduits,
  cotisation: lignesCotisation,
  total
});


    await window.electronAPI.decrementerStock(panier);

    panier = [];
	localStorage.removeItem('panier');
	localStorage.removeItem("adherentId");
adherentSelectionneId = "";


    afficherPanier();
    alert("Vente enregistrée, email envoyé !");
  } catch (err) {
    alert("Erreur lors de la validation : " + err.message);
  }
};



 window.ajouterAuPanierDepuisUI = (id) => {
  const produit = produits.find(p => p.id === id);
  if (!produit) return;

  // 🎯 Animation visuelle sur la carte cliquée
  const carte = document.querySelector(`.produit-card[onclick*="${id}"]`);
  if (carte) {
    carte.classList.add("produit-ajoute");
    setTimeout(() => carte.classList.remove("produit-ajoute"), 400);
  }

  const unite = produit.unite.toLowerCase();
  if (unite === 'kg' || unite === 'litre' || unite === 'l') {
    ouvrirPopupQuantite(produit);
  } else {
    ajouterAuPanier(produit, 1);
  }
};

  
  window.viderPanier = () => {
  if (panier.length === 0) return;

  const ok = confirm("Souhaitez-vous vraiment vider tout le panier ?");
  if (ok) {
    panier = [];
	localStorage.removeItem('panier');
	localStorage.removeItem("adherentId");
adherentSelectionneId = "";


    afficherPanier();
    document.getElementById("search-produit")?.focus();
  }
};


  content.innerHTML = `
    <div class="caisse-topbar">
      <input type="text" id="search-produit" placeholder="🔍 Rechercher un produit..." style="flex: 1; padding: 8px; font-size: 1em;">
    </div>

    <div class="categories-bar">
      ${categories.map(c => `
        <button class="btn-cat-square" data-cat="${c.nom}">${c.nom}</button>
      `).join('')}
    </div>

    <div class="caisse-zone">
      <div id="produits-zone" class="produits-cards"></div>
      <div id="panier-zone"></div>
    </div>

    <!-- POPUP QUANTITÉ -->
    <div id="popup-quantite" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3 id="popup-produit-nom">Quantité</h3>
        <input type="number" id="quantite-input" step="0.01" min="0.01" />
        <div class="modal-actions">
          <button id="popup-valider">Valider</button>
          <button onclick="fermerPopup()">Annuler</button>
        </div>
      </div>
    </div>
  `;
  
  window.fermerPopup = fermerPopup;

document.getElementById('search-produit').addEventListener('input', (e) => {
  const filtre = e.target.value.trim().toLowerCase();

  if (filtre.length > 0) {
    // 🔄 On annule le filtre par catégorie
    categorieActive = null;
    document.querySelectorAll('.btn-cat-square').forEach(b => b.classList.remove('active'));
  }

  const matches = produits.filter(p =>
    p.nom.toLowerCase().includes(filtre) ||
    (p.code_barre && p.code_barre.toLowerCase() === filtre)
  );

  // Cas : code-barre exact trouvé pour un seul produit
  if (filtre && matches.length === 1 && matches[0].code_barre?.toLowerCase() === filtre) {
    const produit = matches[0];
    const unite = produit.unite.toLowerCase();
    if (unite === 'kg' || unite === 'litre' || unite === 'l') {
      ouvrirPopupQuantite(produit);
    } else {
      ajouterAuPanier(produit, 1);
    }

    // Réinitialiser la recherche + catégorie
    e.target.value = '';
    afficherProduits();
    return;
  }

  afficherProduits();
});

  document.querySelectorAll('.btn-cat-square').forEach(btn => {
    btn.addEventListener('click', () => {
      const active = btn.dataset.cat;
      categorieActive = (categorieActive === active) ? null : active;
      document.querySelectorAll('.btn-cat-square').forEach(b => b.classList.remove('active'));
      if (categorieActive) btn.classList.add('active');
      afficherProduits();
    });
  });

  document.getElementById("popup-valider").addEventListener("click", () => {
  const qte = parseFloat(document.getElementById("quantite-input").value);
  if (!isNaN(qte) && qte > 0 && produitEnCours) {
    ajouterAuPanier(produitEnCours, qte);
    fermerPopup();
    document.getElementById("search-produit")?.focus(); // 👈 Ajout ici
  }
});

  // ✅ Valider avec la touche Entrée
document.getElementById("quantite-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("popup-valider").click();
  }
});
// ⛔ Fermer la popup avec la touche Échap
document.getElementById("quantite-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    fermerPopup();
  }
});



  afficherProduits();
  afficherPanier();
  document.getElementById("search-produit")?.focus();

}


async function verifierCotisationAdherent(adherentId, nomComplet, panier, afficherPanier) {
  const estAJour = await window.electronAPI.verifierCotisation(adherentId);

  if (!estAJour) {
    const montant = await showPromptModal(
      `💡 ${nomComplet} n'a pas encore réglé sa cotisation ce mois-ci.\n\nVeuillez saisir un montant (minimum 5 €) :`,
      "5.00"
    );

    const montantNum = parseFloat(montant);
    if (isNaN(montantNum) || montantNum < 5) {
      await showAlertModal("Montant invalide. La cotisation minimum est de 5 €.");
      return;
    }

    panier.push({
      nom: "Cotisation mensuelle",
      fournisseur: "",
      unite: "€",
      prix: montantNum,
      quantite: 1,
      type: "cotisation"
    });

    afficherPanier(); // on redessine le panier
  }
}


// -----------------------------------------------------------------------------
//  Adhérents
// -----------------------------------------------------------------------------

async function renderGestionAdherents() {
  const content = document.getElementById("page-content");
  let viewMode = "actifs"; // "actifs" ou "archives"

  async function chargerEtAfficherAdherents() {
    const adherents = await window.electronAPI.getAdherents(viewMode === "actifs" ? 0 : 1);

    content.innerHTML = `
      <h2>Adhérents (${viewMode === 'actifs' ? 'actifs' : 'archivés'})</h2>
      <div style="margin-bottom: 10px;">
        <button id="btn-ajouter-adherent">+ Ajouter un adhérent</button>
        <button id="toggle-view">${viewMode === 'actifs' ? 'Voir les archivés' : 'Voir les actifs'}</button>
      </div>
      <table border="1" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th>Prénom</th><th>Nom</th><th>Email</th><th>Téléphone</th><th>Adresse</th><th>CP</th><th>Ville</th>
            <th>Droit d'entrée</th><th>Date inscription</th>
            ${viewMode === 'archives' ? '<th>Archivé le</th><th>Réactivé le</th>' : ''}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${adherents.map(a => `
            <tr>
              <td>${a.prenom}</td>
              <td>${a.nom}</td>
              <td>
  ${a.email1 || ''}<br>
  ${a.email2 || ''}
</td>
<td>
  ${a.telephone1 || ''}<br>
  ${a.telephone2 || ''}
</td>

              <td>${a.adresse || ''}</td>
              <td>${a.code_postal || ''}</td>
              <td>${a.ville || ''}</td>
              <td>${a.droit_entree || 0} €</td>
              <td>${a.date_inscription ? new Date(a.date_inscription).toLocaleDateString() : '—'}</td>
              ${viewMode === 'archives' ? `
                <td>${a.date_archivage ? new Date(a.date_archivage).toLocaleDateString() : '—'}</td>
                <td>${a.date_reactivation ? new Date(a.date_reactivation).toLocaleDateString() : '—'}</td>
              ` : ''}
              <td>
                <button class="btn-edit-adherent" data-id="${a.id}">✏️</button>
                <button class="btn-archive-adherent" data-id="${a.id}" data-action="${viewMode === 'actifs' ? 'archiver' : 'reactiver'}">
                  ${viewMode === 'actifs' ? '🗃️ Archiver' : '✅ Réactiver'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Toggle affichage actif / archivé
    document.getElementById('toggle-view').addEventListener('click', () => {
      viewMode = viewMode === 'actifs' ? 'archives' : 'actifs';
      chargerEtAfficherAdherents();
    });

    // Ajouter un adhérent
    document.getElementById("btn-ajouter-adherent").addEventListener("click", async () => {
      const adherent = await showFormModalAdherent();
      if (!adherent) return;

      await window.electronAPI.ajouterAdherent(adherent);
      await showAlertModal("✅ Adhérent ajouté !");
      await chargerEtAfficherAdherents();
    });

    // Archiver / Réactiver
    document.querySelectorAll('.btn-archive-adherent').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const action = btn.dataset.action;
        const confirm = await showConfirmModal(`${action === 'archiver' ? 'Archiver' : 'Réactiver'} cet adhérent ?`);
        if (!confirm) return;

        if (action === 'archiver') {
          await window.electronAPI.archiverAdherent(id);
        } else {
          await window.electronAPI.reactiverAdherent(id);
        }

        await showAlertModal(`✅ Adhérent ${action === 'archiver' ? 'archivé' : 'réactivé'} !`);
        await chargerEtAfficherAdherents();
      });
    });

    // Modifier
    document.querySelectorAll('.btn-edit-adherent').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        const adherents = await window.electronAPI.getAdherents(viewMode === "actifs" ? 0 : 1);
        const a = adherents.find(x => x.id === id);
        if (!a) return;

        const form = document.createElement("form");
        form.innerHTML = `
          <label>Prénom : <input name="prenom" value="${a.prenom}" required></label><br><br>
          <label>Nom : <input name="nom" value="${a.nom}" required></label><br><br>
          <label>Email : <input name="email" value="${a.email}" required></label><br><br>
          <label>Téléphone : <input name="telephone" value="${a.telephone}" required></label><br><br>
          <label>Adresse : <input name="adresse" value="${a.adresse || ''}"></label><br><br>
          <label>Code Postal : <input name="code_postal" value="${a.code_postal || ''}"></label><br><br>
          <label>Ville : <input name="ville" value="${a.ville || ''}"></label><br><br>
          <label>Droit d'entrée (€) : <input name="droit_entree" type="number" step="0.01" value="${a.droit_entree || 0}"></label><br><br>
          <label>Date inscription : <input name="date_inscription" type="date" value="${a.date_inscription ? a.date_inscription.substring(0, 10) : ''}"></label>
        `;

        const result = await showFormModal("Modifier l'adhérent", form);
        if (!result) return;

        const modif = {
          id: a.id,
          prenom: form.prenom.value,
          nom: form.nom.value,
          email: form.email.value,
          telephone: form.telephone.value,
          adresse: form.adresse.value,
          code_postal: form.code_postal.value,
          ville: form.ville.value,
          droit_entree: parseFloat(form.droit_entree.value) || 0,
          date_inscription: form.date_inscription.value || null
        };

        await window.electronAPI.modifierAdherent(modif);
        await showAlertModal("✅ Modifié !");
        await chargerEtAfficherAdherents();
      });
    });
  }

  await chargerEtAfficherAdherents();
}



async function showFormModalAdherent() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 600px;">
        <h3>Ajouter un adhérent</h3>
        <form id="form-adherent">
          <label>Prénom : <input name="prenom" required></label><br><br>
          <label>Nom : <input name="nom" required></label><br><br>
          <label>Email : <input name="email" type="email" required></label><br><br>
          <label>Téléphone : <input name="telephone" required></label><br><br>
          <label>Adresse : <input name="adresse"></label><br><br>
          <label>Code postal : <input name="code_postal"></label><br><br>
          <label>Ville : <input name="ville"></label><br><br>
          <label>Date d’inscription : <input type="date" name="date_inscription" value="${new Date().toISOString().split('T')[0]}"></label><br><br>
          <label>Droit d’entrée payé (€) : <input type="number" step="0.01" name="droit_entree" value="0"></label><br><br>

          <div class="modal-actions">
            <button type="submit">💾 Enregistrer</button>
            <button type="button" id="cancel-ajout-adherent">Annuler</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Annuler
    document.getElementById('cancel-ajout-adherent').onclick = () => {
      modal.remove();
      resolve(null);
    };

    // Enregistrer
    document.getElementById('form-adherent').onsubmit = (e) => {
      e.preventDefault();
      const form = e.target;
      const adherent = {
        nom: form.nom.value.trim(),
        prenom: form.prenom.value.trim(),
        email: form.email.value.trim(),
        telephone: form.telephone.value.trim(),
        adresse: form.adresse.value.trim(),
        code_postal: form.code_postal.value.trim(),
        ville: form.ville.value.trim(),
        date_inscription: form.date_inscription.value,
        droit_entree: parseFloat(form.droit_entree.value) || 0
      };
      modal.remove();
      resolve(adherent);
    };
  });
}

async function renderImportAdherents() {
  const container = document.getElementById('parametres-souspage');

  const filePath = await window.electronAPI.choisirFichier();
    console.log("📁 Fichier choisi :", filePath);

  if (!filePath) {
    container.innerHTML = `<p>Aucun fichier sélectionné.</p>`;
    return;
  }

  container.innerHTML = `<p>Chargement du fichier...</p>`;

  const data = await window.electronAPI.analyserImportAdherents(filePath);
  if (!data || data.status !== 'ok') {
    container.innerHTML = `<p>Erreur lors de l'import du fichier.</p>`;
    return;
  }

  const { adherents, tranches_age } = data;

  container.innerHTML = `
    <h3>Prévisualisation des adhérents importés</h3>
    <table class="table-import">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Prénom</th>
          <th>Email 1</th>
          <th>Email 2</th>
          <th>Téléphone 1</th>
          <th>Téléphone 2</th>
          <th>Adresse</th>
          <th>CP</th>
          <th>Ville</th>
          <th>Foyer</th>
          <th>Tranche d'âge</th>
        </tr>
      </thead>
      <tbody>
        ${adherents.map((a, i) => `
          <tr>
            <td>${a.nom}</td>
            <td>${a.prenom}</td>
            <td>${a.email1}</td>
            <td>${a.email2}</td>
            <td>${a.telephone1}</td>
            <td>${a.telephone2}</td>
            <td>${a.adresse}</td>
            <td>${a.code_postal}</td>
            <td>${a.ville}</td>
            <td>${a.nb_personnes_foyer || 0}</td>
            <td>
              <select data-index="${i}" class="select-tranche">
                <option value="">-- Choisir --</option>
                ${tranches_age.map(t => `
                  <option value="${t}" ${a.tranche_age === t ? 'selected' : ''}>${t}</option>
                `).join('')}
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <button class="btn-valider" id="valider-import-adherents" style="margin-top: 20px;">
      ✅ Valider l'import
    </button>
  `;

  document.querySelectorAll('.select-tranche').forEach(sel => {
    sel.addEventListener('change', e => {
      const index = parseInt(e.target.dataset.index);
      adherents[index].tranche_age = e.target.value;
    });
  });

  document.getElementById('valider-import-adherents').addEventListener('click', async () => {
    const confirm = await showConfirmModal(`Confirmer l'import de ${adherents.length} adhérent(s) ?`);
    if (!confirm) return;

    const result = await window.electronAPI.validerImportAdherents(adherents);
 await showAlertModal(result?.message || "Import terminé.");
    renderImportExcel(); // retour à la liste
  });
}







// -----------------------------------------------------------------------------
//  Cotisations
// -----------------------------------------------------------------------------

async function renderCotisations() {
  const container = document.getElementById("page-content");
  const cotisations = await window.electronAPI.getCotisations();

  // 🔁 Récupérer la liste unique des mois et adhérents
  const moisList = [...new Set(cotisations.map(c => c.mois))].sort().reverse();
  const adherentsList = [...new Set(cotisations.map(c => `${c.prenom} ${c.nom}`))].sort();

  // 📅 Valeur par défaut : mois actuel
  const moisActuel = new Date().toISOString().slice(0, 7);
  let selectedMois = moisActuel;
  let selectedAdherent = "";

  // 📦 Filtrer et afficher
  const filtrerEtAfficher = () => {
    const data = cotisations.filter(c => {
      const matchMois = selectedMois === "" || c.mois === selectedMois;
      const nomComplet = `${c.prenom} ${c.nom}`;
      const matchAdherent = selectedAdherent === "" || nomComplet === selectedAdherent;
      return matchMois && matchAdherent;
    });

    const total = data.reduce((s, c) => s + c.montant, 0);

    document.getElementById("cotisations-table").innerHTML = `
      <table class="styled-table">
        <thead>
          <tr>
            <th>Adhérent</th>
            <th>Mois</th>
            <th>Montant (€)</th>
            <th>Date paiement</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(c => `
            <tr>
              <td>${c.prenom} ${c.nom}</td>
              <td>${c.mois}</td>
              <td>
                <input type="number" value="${c.montant.toFixed(2)}" data-id="${c.id}" class="input-cotisation-montant" step="0.01" min="0">
              </td>
              <td>${c.date_paiement?.slice(0, 10) || '—'}</td>
              <td>
                <button class="btn-danger" data-id="${c.id}">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p><strong>Total pour le mois ${selectedMois} :</strong> ${total.toFixed(2)} €</p>
    `;

    // 🎯 Edition du montant
    document.querySelectorAll(".input-cotisation-montant").forEach(input => {
      input.addEventListener("change", async () => {
        const id = input.dataset.id;
        const montant = parseFloat(input.value);
        if (!isNaN(montant)) {
          await window.electronAPI.updateCotisationMontant({ id, montant });
        }
      });
    });

    // 🗑️ Suppression
    document.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (confirm("Supprimer cette cotisation ?")) {
          await window.electronAPI.deleteCotisation(id);
          const index = cotisations.findIndex(c => c.id === parseInt(id));
          if (index !== -1) cotisations.splice(index, 1);
          filtrerEtAfficher();
        }
      });
    });
  };

  // 🧱 Interface HTML
  container.innerHTML = `
    <h2>💰 Gestion des cotisations</h2>
    <div style="display:flex; gap:20px; margin-bottom:20px;">
      <div>
        <label>Mois :</label><br>
        <select id="filter-mois">
          <option value="">-- Tous --</option>
          ${moisList.map(m => `<option value="${m}" ${m === moisActuel ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Adhérent :</label><br>
        <select id="filter-adherent">
          <option value="">-- Tous --</option>
          ${adherentsList.map(n => `<option value="${n}">${n}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="cotisations-table"></div>
  `;

  // 🎯 Gestion des filtres
  document.getElementById("filter-mois").addEventListener("change", e => {
    selectedMois = e.target.value;
    filtrerEtAfficher();
  });

  document.getElementById("filter-adherent").addEventListener("change", e => {
    selectedAdherent = e.target.value;
    filtrerEtAfficher();
  });

  // 🔁 Affichage initial
  filtrerEtAfficher();
}













// -----------------------------------------------------------------------------
//  Historique factures
// -----------------------------------------------------------------------------


async function renderHistoriqueFactures() {
  const container = document.getElementById('page-content');
  if (!container) return;

  const ventes = await window.electronAPI.getHistoriqueVentes();

  // 🧠 Charger tous les détails des ventes (une seule fois pour les filtres)
  const ventesAvecProduits = await Promise.all(
    ventes.map(async (v) => {
      const details = await window.electronAPI.getFactureDetails(v.vente_id);
      const produits = details.lignes.map(l => l.nom.toLowerCase()).join(" ");
      return { ...v, produits };
    })
  );

  container.innerHTML = `
    <h2>Historique des ventes</h2>
    <input type="text" id="recherche-vente" placeholder="🔍 Rechercher par nom, date ou produit..." style="margin-bottom: 10px; padding: 6px; width: 100%;">

    <table class="historique-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Adhérent</th>
          <th>Total</th>
          <th>Détail</th>
        </tr>
      </thead>
      <tbody id="ventes-tbody">
        ${ventesAvecProduits.map(v => `
          <tr 
            data-nom="${(v.adherent || '').toLowerCase()}" 
            data-date="${v.date_vente}" 
            data-produits="${v.produits}"
          >
            <td>${v.date_vente}</td>
            <td>${v.adherent || '—'}</td>
            <td>${v.total.toFixed(2)} €</td>
            <td><button data-id="${v.vente_id}" class="voir-detail-btn">Voir</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div id="facture-popup" class="modal-overlay" style="display:none;">
      <div class="modal">
        <div id="facture-detail"></div>
        <div style="text-align: right; margin-top: 10px;">
          <button onclick="fermerPopupFacture()">Fermer</button>
        </div>
      </div>
    </div>
  `;

  // 🔍 Recherche étendue
  document.getElementById('recherche-vente').addEventListener('input', (e) => {
    const filtre = e.target.value.toLowerCase();
    document.querySelectorAll('#ventes-tbody tr').forEach(tr => {
      const nom = tr.getAttribute('data-nom');
      const date = tr.getAttribute('data-date');
      const produits = tr.getAttribute('data-produits');
      const visible = nom.includes(filtre) || date.includes(filtre) || produits.includes(filtre);
      tr.style.display = visible ? '' : 'none';
    });
  });

  // 🔁 Bouton "Voir"
  document.querySelectorAll('.voir-detail-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'));
      const details = await window.electronAPI.getFactureDetails(id);

      const html = `
        <h3>Détail de la vente</h3>
        <p><strong>Date :</strong> ${details.date_vente}</p>
        <p><strong>Adhérent :</strong> ${details.nom_adherent}</p>
        <table border="1" cellpadding="6" cellspacing="0" width="100%">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Quantité</th>
              <th>PU</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${details.lignes.map(l => `
              <tr>
                <td>${l.nom}</td>
                <td>${l.quantite}</td>
                <td>${l.prix.toFixed(2)} €</td>
                <td>${(l.prix * l.quantite).toFixed(2)} €</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="margin-top: 10px;"><strong>Total :</strong> ${details.total.toFixed(2)} €</p>
      `;

      document.getElementById('facture-detail').innerHTML = html;
      document.getElementById('facture-popup').style.display = 'flex';
    });
  });
}





async function afficherDetailsFacture(venteId) {
  const facture = await window.electronAPI.getFactureDetails(venteId);

  const html = `
    <h2>🧾 Détail facture #${venteId}</h2>
    <p><strong>Date :</strong> ${new Date(facture.date_vente).toLocaleString()}</p>
    <p><strong>Adhérent :</strong> ${facture.nom_adherent}</p>
    <table class="table">
      <thead>
        <tr><th>Produit</th><th>Quantité</th><th>Prix</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${facture.lignes.map(p => `
          <tr>
            <td>${p.nom}</td>
            <td>${p.quantite}</td>
            <td>${p.prix.toFixed(2)} €</td>
            <td>${(p.prix * p.quantite).toFixed(2)} €</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p><strong>Total :</strong> ${facture.total.toFixed(2)} €</p>
    <button onclick="renderHistoriqueFactures()">Retour</button>
  `;
  document.getElementById('content').innerHTML = html;
}


async function voirDetailVente(venteId) {
  try {
    const lignes = await window.electronAPI.getDetailVente(venteId);
    const detailContainer = document.getElementById('facture-detail');

    if (!detailContainer) return;

    const total = lignes.reduce((sum, l) => sum + l.prix * l.quantite, 0);

    detailContainer.innerHTML = `
      <h3>Détail de la vente #${venteId}</h3>
      <table class="detail-facture">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Fournisseur</th>
            <th>Unité</th>
            <th>Prix</th>
            <th>Quantité</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${lignes.map(l => `
            <tr>
              <td>${l.nom}</td>
              <td>${l.fournisseur_nom || '—'}</td>
              <td>${l.unite}</td>
              <td>${l.prix.toFixed(2)} €</td>
              <td>${l.quantite}</td>
              <td>${(l.prix * l.quantite).toFixed(2)} €</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p><strong>Total :</strong> ${total.toFixed(2)} €</p>
    `;
  } catch (err) {
    console.error('Erreur lors du chargement du détail :', err);
  }
}



// -----------------------------------------------------------------------------
//  Reception
// -----------------------------------------------------------------------------




async function renderReception() {
  const content = document.getElementById("page-content");
  const fournisseurs = await window.electronAPI.getFournisseurs();
  const produits = await window.electronAPI.getProduits();

  let fournisseurSelectionne = null;
  let produitsFournisseur = [];
  let lignesReception = [];

  const afficherInterface = () => {
    content.innerHTML = `
      <div class="reception-header">
        <h2>📦 Réception de produits</h2>
        <div style="display: flex; gap: 20px; margin-top: 10px;">
          <select id="select-fournisseur">
            <option value="">-- Sélectionner un fournisseur --</option>
            ${fournisseurs.map(f => `<option value="${f.id}">${f.nom}</option>`).join('')}
          </select>

          
          <input type="text" id="commentaire-reception" placeholder="Commentaire">
        </div>

        <div style="margin-top: 20px;">
          <input type="text" id="recherche-produit" placeholder="🔍 Rechercher un produit du fournisseur..." style="width: 100%; padding: 8px;">
        </div>
      </div>

      <div id="zone-lignes-reception" style="margin-top: 30px;"></div>

      <div style="margin-top: 20px;">
        <button id="valider-reception" class="btn-valider">✅ Valider la réception</button>
      </div>

      <div id="liste-produits-fournisseur" style="margin-top: 40px;"></div>
    `;

    document.getElementById("select-fournisseur").addEventListener("change", e => {
      const id = parseInt(e.target.value);
      fournisseurSelectionne = id || null;
      produitsFournisseur = produits.filter(p => p.fournisseur_id === fournisseurSelectionne);
      afficherLignes();
      afficherListeProduitsFournisseur();
    });

    document.getElementById("recherche-produit").addEventListener("input", e => {
  afficherListeProduitsFournisseur(e.target.value);
});


    document.getElementById("valider-reception").addEventListener("click", async () => {
      if (!fournisseurSelectionne) return alert("Merci de sélectionner un fournisseur.");
      if (lignesReception.length === 0) return alert("Aucun produit ajouté.");

      const lignes = lignesReception.map(l => ({
        produitId: l.produit.id,
        quantite: parseFloat(l.quantite) || null,
        prix: parseFloat(l.prix) || null,
        stockCorrige: l.stockCorrige !== '' ? parseFloat(l.stockCorrige) : null
      }));

      const reception = {
        fournisseurId: parseInt(fournisseurSelectionne),
bonLivraison: `BL-${Date.now()}-${fournisseurSelectionne}`,
        commentaire: document.getElementById("commentaire-reception").value.trim(),
        lignes
      };

      const res = await window.electronAPI.enregistrerReception(reception);
      if (res.success) {
        alert("Réception enregistrée ✅");
        renderReception();
      } else {
        alert("Erreur : " + res.error);
      }
    });
  };

  const afficherLignes = () => {
    const zone = document.getElementById("zone-lignes-reception");
    if (!zone) return;
    if (lignesReception.length === 0) {
      zone.innerHTML = '<p style="color:#666;">Aucun produit ajouté.</p>';
      return;
    }

    zone.innerHTML = `
      <table class="reception-table">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Stock actuel</th>
            <th>Corriger le stock</th>
            <th>Qté reçue</th>
            <th>Prix actuel</th>
            <th>Nouveau prix</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${lignesReception.map((l, i) => `
            <tr>
              <td>${l.produit.nom}</td>
              <td>${l.produit.stock}</td>
              <td><input type="number" step="0.01" data-index="${i}" data-type="stockCorrige" value="${l.stockCorrige}"></td>
              <td><input type="number" step="0.01" data-index="${i}" data-type="quantite" value="${l.quantite}"></td>
              <td>${l.produit.prix.toFixed(2)} €</td>
              <td><input type="number" step="0.01" data-index="${i}" data-type="prix" value="${l.prix}"></td>
              <td><button data-index="${i}" class="btn-supprimer-ligne">🗑️</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.querySelectorAll("input[data-type]").forEach(input => {
      input.addEventListener("input", e => {
        const i = parseInt(e.target.dataset.index);
        const type = e.target.dataset.type;
        lignesReception[i][type] = e.target.value;
      });
    });

    document.querySelectorAll(".btn-supprimer-ligne").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.index);
        lignesReception.splice(i, 1);
        afficherLignes();
      });
    });
  };

const afficherListeProduitsFournisseur = (filtre = '') => {
  const zone = document.getElementById("liste-produits-fournisseur");
  if (!zone || !fournisseurSelectionne) return;

  let produitsFiltres = produitsFournisseur;
  if (filtre.trim()) {
    const val = filtre.toLowerCase();
    produitsFiltres = produitsFournisseur.filter(p =>
      p.nom.toLowerCase().includes(val) || (p.code_barre && p.code_barre.includes(val))
    );
  }

  if (produitsFiltres.length === 0) {
    zone.innerHTML = '<p style="color:#999">Aucun produit ne correspond à votre recherche.</p>';
    return;
  }

  zone.innerHTML = `
    <h3>📦 Produits du fournisseur</h3>
    <div class="produits-cards">
      ${produitsFiltres.map(p => `
        <div class="produit-card" onclick="ajouterProduitReception(${p.id})">
          <strong>${p.nom}</strong>
          <div>Stock : ${p.stock}</div>
          <div>${p.prix.toFixed(2)} €</div>
        </div>
      `).join('')}
    </div>
  `;
};


 window.ajouterProduitReception = (id) => {
  const produit = produitsFournisseur.find(p => p.id === id);
  if (produit && !lignesReception.some(l => l.produit.id === id)) {
    lignesReception.push({ produit, quantite: '', prix: produit.prix, stockCorrige: '' });
    afficherLignes();

    // 🧽 Vider la recherche après ajout
    const inputRecherche = document.getElementById("recherche-produit");
    if (inputRecherche) inputRecherche.value = "";
    afficherListeProduitsFournisseur(); // recharge toute la liste
  }
};


  afficherInterface();
}


async function renderReceptions() {
  const content = document.getElementById("page-content");

  const [receptions, fournisseurs] = await Promise.all([
    window.electronAPI.getReceptions(),
    window.electronAPI.getFournisseurs()
  ]);

  let filtreMois = '';
  let filtreAnnee = '';
  let filtreFournisseur = '';

  const anneesDisponibles = Array.from(
    new Set(receptions.map(r => new Date(r.date).getFullYear()))
  ).sort();

  const afficher = () => {
    const receptionsFiltrees = receptions.filter(r => {
      const d = new Date(r.date);
      const dateOK =
        (!filtreMois || d.getMonth() + 1 === parseInt(filtreMois)) &&
        (!filtreAnnee || d.getFullYear() === parseInt(filtreAnnee));
      const fournisseurOK = !filtreFournisseur || r.fournisseur_nom === filtreFournisseur;
      return dateOK && fournisseurOK;
    });

    content.innerHTML = `
      <h2>📦 Historique des réceptions</h2>

      <div style="display:flex; gap:20px; margin: 20px 0;">
        <div>
          <label>Mois :</label><br>
          <select id="filtre-mois">
            <option value="">-- Tous --</option>
            ${[...Array(12)].map((_, i) => `
              <option value="${i + 1}" ${filtreMois == i + 1 ? 'selected' : ''}>${(i + 1).toString().padStart(2, '0')}</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label>Année :</label><br>
          <select id="filtre-annee">
            <option value="">-- Toutes --</option>
            ${anneesDisponibles.map(annee => `
              <option value="${annee}" ${filtreAnnee == annee ? 'selected' : ''}>${annee}</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label>Fournisseur :</label><br>
          <select id="filtre-fournisseur">
            <option value="">-- Tous --</option>
            ${fournisseurs.map(f => `
              <option value="${f.nom}" ${filtreFournisseur === f.nom ? 'selected' : ''}>${f.nom}</option>
            `).join('')}
          </select>
        </div>
      </div>

      ${receptionsFiltrees.length === 0 ? '<p>Aucune réception trouvée.</p>' : `
        <table class="reception-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Bon de livraison</th>
              <th>Fournisseur</th>
              <th>Commentaire</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${receptionsFiltrees.map(r => `
              <tr>
                <td>${new Date(r.date).toLocaleString()}</td>
                <td>${r.bon_livraison}</td>
                <td>${r.fournisseur_nom || '—'}</td>
                <td>${r.commentaire || ''}</td>
                <td><button class="btn-voir-reception" data-id="${r.id}">📄 Voir</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    `;

    // Listeners pour les filtres
    document.getElementById("filtre-mois").addEventListener("change", e => {
      filtreMois = e.target.value;
      afficher();
    });

    document.getElementById("filtre-annee").addEventListener("change", e => {
      filtreAnnee = e.target.value;
      afficher();
    });

    document.getElementById("filtre-fournisseur").addEventListener("change", e => {
      filtreFournisseur = e.target.value;
      afficher();
    });

    // ✅ Listener pour le bouton "📄 Voir"
    document.querySelectorAll(".btn-voir-reception").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.id);
        if (id && typeof window.voirDetailsReception === "function") {
          window.voirDetailsReception(id);
        } else {
          alert("La fonction 'voirDetailsReception' est introuvable.");
        }
      });
    });
  };

  afficher();
}
