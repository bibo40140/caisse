// src/renderer/pages/parametres/mon-compte/modes_paiement.js
(function () {
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m]));
  }

  async function refresh(listEl) {
    try {
      const rows = await window.electronAPI?.mp_getAll?.();
      if (!Array.isArray(rows) || rows.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500">Aucun mode de paiement pour l’instant.</p>`;
        return;
      }
      listEl.innerHTML = rows.map(r => `
        <div class="p-3 rounded border flex items-center justify-between">
          <div>
            <div><b>${escapeHtml(r.nom)}</b> ${r.actif ? '<span class="text-green-600">• actif</span>' : '<span class="text-gray-400">• inactif</span>'}</div>
            <div class="text-sm text-gray-600">Taux: ${Number(r.taux_percent||0)}% — Fixe: ${Number(r.frais_fixe||0)} €</div>
          </div>
          <div class="space-x-2">
            <button data-id="${r.id}" class="mp-edit px-2 py-1 rounded border">Modifier</button>
            <button data-id="${r.id}" class="mp-del px-2 py-1 rounded border text-red-600">Supprimer</button>
          </div>
        </div>
      `).join('');
      listEl.querySelectorAll('.mp-edit').forEach(b => b.onclick = (ev) => onEdit(ev, listEl));
      listEl.querySelectorAll('.mp-del').forEach(b => b.onclick = (ev) => onDelete(ev, listEl));
    } catch (e) {
      listEl.innerHTML = `<p class="text-red-600">Erreur: ${escapeHtml(e?.message || String(e))}</p>`;
    }
  }

  async function onAdd(listEl) {
    const nom  = prompt('Nom du mode ? (ex: Espèces)');
    if (!nom) return;
    const taux = Number(prompt('Taux (%) ?', '0') || 0);
    const fixe = Number(prompt('Frais fixe (€) ?', '0') || 0);
    await window.electronAPI?.mp_create?.({ nom, taux_percent: taux, frais_fixe: fixe, actif: 1 });
    await refresh(listEl);
  }

  async function onEdit(ev, listEl) {
    const id = Number(ev.currentTarget.dataset.id);
    const cur = await window.electronAPI?.mp_getAll?.();
    const row = Array.isArray(cur) ? cur.find(x => Number(x.id) === id) : null;

    const nom  = prompt('Nom ?', row?.nom ?? '');
    if (!nom) return;
    const taux = Number(prompt('Taux (%) ?', String(row?.taux_percent ?? '0')) || 0);
    const fixe = Number(prompt('Frais fixe (€) ?', String(row?.frais_fixe ?? '0')) || 0);
    const actif = confirm('Activer ce mode ?');
    await window.electronAPI?.mp_update?.({ id, nom, taux_percent: taux, frais_fixe: fixe, actif: actif ? 1 : 0 });
    await refresh(listEl);
  }

  async function onDelete(ev, listEl) {
    const id = Number(ev.currentTarget.dataset.id);
    if (!confirm('Supprimer ce mode ?')) return;
    await window.electronAPI?.mp_remove?.(id);
    await refresh(listEl);
  }

  async function render(root) {
    // si on t’a passé le host parent depuis MonCompte.showTab, on l’utilise tel quel
    const host = root || document.getElementById('parametres-souspage');
    if (!host) return;

    host.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold">Modes de paiement</h3>
        <button id="mp-add" class="px-3 py-1 rounded bg-blue-600 text-white">Ajouter</button>
      </div>
      <div id="mp-list" class="space-y-2"></div>
    `;
    const listEl = host.querySelector('#mp-list');
    host.querySelector('#mp-add').onclick = () => onAdd(listEl);
    await refresh(listEl);
  }

  window.PageModesPaiement = { render };
})();
