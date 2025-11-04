// src/renderer/pages/parametres/mon-compte/unites.js
(() => {
  async function render() {
    const container = document.getElementById('parametres-souspage');
    if (!container) return;

    const unites = await window.electronAPI.getUnites();
    container.innerHTML = `
      <h3>Gestion des unités de mesure</h3>
      <form id="form-unite" style="display:flex; gap:8px; flex-wrap:wrap; align-items:end;">
        <input name="nom" placeholder="Nouvelle unité (ex: kg, litre, pièce)" required>
        <button type="submit" class="btn">Ajouter</button>
      </form>
      <br>
      <table class="table" width="100%" style="border-collapse: collapse;">
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
                <button class="btn btn-ghost btn-edit">Modifier</button>
                <button class="btn btn-primary btn-save" style="display:none;">Enregistrer</button>
                <button class="btn btn-danger btn-supprimer">Supprimer</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('form-unite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = e.target.nom.value.trim();
      if (!nom.length) return;
      await window.electronAPI.ajouterUnite(nom);
      render();
    });

    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        row.querySelector('.nom-unite').style.display = 'none';
        row.querySelector('.edit-unite').style.display = 'inline-block';
        row.querySelector('.btn-edit').style.display = 'none';
        row.querySelector('.btn-save').style.display = 'inline-block';
      });
    });
    container.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = row.dataset.id;
        const newName = row.querySelector('.edit-unite').value.trim();
        if (!newName.length) return;
        await window.electronAPI.modifierUnite(parseInt(id,10), newName);
        render();
      });
    });
    container.querySelectorAll('.btn-supprimer').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        const id = parseInt(row.dataset.id,10);
        const result = await window.electronAPI.supprimerUnite(id);
        if (typeof result === 'string') alert(result);
        else render();
      });
    });
  }

  window.PageParamsUnites = { render };
})();
