// src/renderer/pages/adherents.js
(() => {
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
            <th>Statut</th>
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
              <td>${(a.statut || 'actif')}</td>
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
  // Ajouter un adhérent
document.getElementById("btn-ajouter-adherent").addEventListener("click", async () => {
  const adherent = await showFormModalAdherent(); // <- renverra désormais email1/2 et telephone1/2
  if (!adherent) return;

  // On envoie tel quel : la DB attend ces colonnes
  await window.electronAPI.ajouterAdherent({
    nom: adherent.nom,
    prenom: adherent.prenom,
    email1: adherent.email1,
    email2: adherent.email2,
    telephone1: adherent.telephone1,
    telephone2: adherent.telephone2,
    adresse: adherent.adresse,
    code_postal: adherent.code_postal,
    ville: adherent.ville,
    date_inscription: adherent.date_inscription,
    droit_entree: adherent.droit_entree,
    statut: adherent.statut || 'actif'
  });

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

  <fieldset style="border:1px solid #ddd; padding:10px;">
    <legend>Emails</legend>
    <label>Email 1 : <input name="email1" type="email" value="${a.email1 || ''}"></label><br><br>
    <label>Email 2 : <input name="email2" type="email" value="${a.email2 || ''}"></label>
  </fieldset><br>

  <fieldset style="border:1px solid #ddd; padding:10px;">
    <legend>Téléphones</legend>
    <label>Téléphone 1 : <input name="telephone1" value="${a.telephone1 || ''}"></label><br><br>
    <label>Téléphone 2 : <input name="telephone2" value="${a.telephone2 || ''}"></label>
  </fieldset><br>

  <label>Adresse : <input name="adresse" value="${a.adresse || ''}"></label><br><br>
  <label>Code Postal : <input name="code_postal" value="${a.code_postal || ''}"></label><br><br>
  <label>Ville : <input name="ville" value="${a.ville || ''}"></label><br><br>

  <label>Statut :
  <select name="statut">
    ${(() => {
      const s = (a.statut || 'actif').toLowerCase();
      return `
        <option value="actif" ${s==='actif'?'selected':''}>Actif</option>
        <option value="partenaire" ${s==='partenaire'?'selected':''}>Partenaire</option>
        <option value="exempté" ${s==='exempté'?'selected':''}>Exempté</option>
        <option value="autre" ${s==='autre'?'selected':''}>Autre</option>
      `;
    })()}
  </select>
</label><br><br>


  <label>Droit d'entrée (€) : <input name="droit_entree" type="number" step="0.01" value="${a.droit_entree || 0}"></label><br><br>
  <label>Date inscription : <input name="date_inscription" type="date" value="${a.date_inscription ? a.date_inscription.substring(0, 10) : ''}"></label>
`;

const result = await showFormModal("Modifier l'adhérent", form);
if (!result) return;

const modif = {
  id: a.id,
  prenom: form.prenom.value.trim(),
  nom: form.nom.value.trim(),
  email1: (form.email1.value || '').trim(),
  email2: (form.email2.value || '').trim(),
  telephone1: (form.telephone1.value || '').trim(),
  telephone2: (form.telephone2.value || '').trim(),
  adresse: (form.adresse.value || '').trim(),
  code_postal: (form.code_postal.value || '').trim(),
  ville: (form.ville.value || '').trim(),
  droit_entree: parseFloat(form.droit_entree.value) || 0,
  date_inscription: form.date_inscription.value || null,
  statut: (form.statut.value || 'actif')
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

          <fieldset style="border:1px solid #ddd; padding:10px;">
            <legend>Emails</legend>
            <label>Email 1 : <input name="email1" type="email"></label><br><br>
            <label>Email 2 : <input name="email2" type="email"></label>
          </fieldset><br>

          <fieldset style="border:1px solid #ddd; padding:10px;">
            <legend>Téléphones</legend>
            <label>Téléphone 1 : <input name="telephone1"></label><br><br>
            <label>Téléphone 2 : <input name="telephone2"></label>
          </fieldset><br>

          <label>Adresse : <input name="adresse"></label><br><br>
          <label>Code postal : <input name="code_postal"></label><br><br>
          <label>Ville : <input name="ville"></label><br><br>

          <label>Date d’inscription :
            <input type="date" name="date_inscription" value="${new Date().toISOString().split('T')[0]}">
          </label><br><br>

          <label>Statut :
  <select name="statut">
    <option value="actif" selected>Actif</option>
    <option value="partenaire">Partenaire</option>
    <option value="exempté">Exempté</option>
    <option value="autre">Autre</option>
  </select>
</label><br><br>


          <label>Droit d’entrée payé (€) :
            <input type="number" step="0.01" name="droit_entree" value="0">
          </label><br><br>

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
  nom: (form.nom.value || '').trim(),
  prenom: (form.prenom.value || '').trim(),
  email1: (form.email1.value || '').trim(),
  email2: (form.email2.value || '').trim(),
  telephone1: (form.telephone1.value || '').trim(),
  telephone2: (form.telephone2.value || '').trim(),
  adresse: (form.adresse.value || '').trim(),
  code_postal: (form.code_postal.value || '').trim(),
  ville: (form.ville.value || '').trim(),
  date_inscription: form.date_inscription.value || null,
  droit_entree: parseFloat(form.droit_entree.value) || 0,
  statut: (form.statut.value || 'actif')
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
await window.electronAPI.modifierCotisation({ id, montant, date_paiement: new Date().toISOString().slice(0,10) });
        }
      });
    });
    // 🗑️ Suppression
    document.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        if (confirm("Supprimer cette cotisation ?")) {
await window.electronAPI.supprimerCotisation(id);
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
async function verifierCotisationAdherent(adherentId, nomComplet, panier, afficherPanier) {
  const estAJour = await window.electronAPI.verifierCotisation(adherentId);
  if (estAJour) return true;

  // Boucle jusqu'à obtenir un entier ≥ 5
  // -> "Annuler" re-affiche la saisie (pas de sortie possible tant que non saisi)
  // Si tu veux une vraie annulation de la vente, je te fais une variante avec confirm.
  for (;;) {
    const montantStr = await showPromptModal(
      `💡 ${nomComplet} n'a pas réglé sa cotisation ce mois-ci.\n\nEntrez un montant (ENTIER ≥ 5 €) :`,
      "5"
    );

    // Annuler -> on informe puis on RE-AFFICHE la saisie (continue la boucle)
    if (montantStr === null) {
      await showAlertModal("Cotisation non saisie. Merci d’entrer un montant pour continuer.");
      continue;
    }

    const montant = parseInt(montantStr, 10);

    if (Number.isInteger(montant) && montant >= 5) {
      // Évite les doublons si l'utilisateur a déjà ajouté une cotisation dans le panier
      const ligneExistante = panier.find(p => p.type === "cotisation");
      if (ligneExistante) {
        ligneExistante.prix = montant;
      } else {
        panier.push({
          nom: "Cotisation mensuelle",
          fournisseur: "",
          unite: "€",
          prix: montant,
          quantite: 1,
          type: "cotisation"
        });
      }
      afficherPanier();
      return true;
    }

    await showAlertModal("Montant invalide. Entrez un ENTIER supérieur ou égal à 5 €.");
    // et la boucle recommence
  }
}


  // Export vers le global (appelés par les wrappers du renderer)
  window.PageAdherents = {
    renderGestionAdherents,
    showFormModalAdherent,
    renderImportAdherents,
    renderCotisations,
	verifierCotisationAdherent
  };
})();
