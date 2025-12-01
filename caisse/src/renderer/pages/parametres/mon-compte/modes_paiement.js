// src/renderer/pages/parametres/mon-compte/modes_paiement.js
(function () {
  

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
    const data = await openModePaiementForm({
      title: 'Ajouter un mode de paiement',
      nom: '', taux_percent: 0, frais_fixe: 0, actif: true,
    });
    if (!data) return;
    await window.electronAPI?.mp_create?.({
      nom: String(data.nom || '').trim(),
      taux_percent: Number(data.taux_percent || 0),
      frais_fixe: Number(data.frais_fixe || 0),
      actif: data.actif ? 1 : 0,
    });
    await refresh(listEl);
  }

  async function onEdit(ev, listEl) {
    const id = Number(ev.currentTarget.dataset.id);
    const cur = await window.electronAPI?.mp_getAll?.();
    const row = Array.isArray(cur) ? cur.find(x => Number(x.id) === id) : null;
    const data = await openModePaiementForm({
      title: 'Modifier le mode de paiement',
      nom: row?.nom ?? '',
      taux_percent: Number(row?.taux_percent ?? 0),
      frais_fixe: Number(row?.frais_fixe ?? 0),
      actif: !!row?.actif,
    });
    if (!data) return;
    await window.electronAPI?.mp_update?.({
      id,
      nom: String(data.nom || '').trim(),
      taux_percent: Number(data.taux_percent || 0),
      frais_fixe: Number(data.frais_fixe || 0),
      actif: data.actif ? 1 : 0,
    });
    await refresh(listEl);
  }

  async function onDelete(ev, listEl) {
    const id = Number(ev.currentTarget.dataset.id);
    const ok = await openConfirm('Supprimer ce mode de paiement ?');
    if (!ok) return;
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

  // ---------- petites boîtes de dialogue maison ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function openConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.setAttribute('style', [
        'position:fixed','left:0','top:0','right:0','bottom:0',
        'background:rgba(0,0,0,0.4)','display:flex','align-items:center','justify-content:center',
        'z-index:10000'
      ].join(';'));
      const modal = document.createElement('div');
      modal.setAttribute('style', [
        'background:#fff','border-radius:10px','box-shadow:0 8px 30px rgba(0,0,0,0.25)',
        'width:100%','max-width:520px','padding:16px','box-sizing:border-box'
      ].join(';'));
      modal.innerHTML = `
        <div style="font-size:14px; margin-bottom:12px;">${escapeHtml(message)}</div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button data-act="cancel" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; background:#fff; color:#111827; cursor:pointer;">Annuler</button>
          <button data-act="ok" style="padding:6px 10px; border:1px solid #b91c1c; background:#dc2626; color:#fff; border-radius:6px; cursor:pointer;">Supprimer</button>
        </div>`;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.querySelector('[data-act="cancel"]').onclick = () => { cleanup(); resolve(false); };
      overlay.querySelector('[data-act="ok"]').onclick = () => { cleanup(); resolve(true); };
      function cleanup() { overlay.remove(); }
    });
  }

  function openModePaiementForm({ title, nom, taux_percent, frais_fixe, actif }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.setAttribute('style', [
        'position:fixed','left:0','top:0','right:0','bottom:0',
        'background:rgba(0,0,0,0.4)','display:flex','align-items:center','justify-content:center',
        'z-index:10000'
      ].join(';'));
      const form = document.createElement('form');
      form.setAttribute('style', [
        'background:#fff','border-radius:10px','box-shadow:0 8px 30px rgba(0,0,0,0.25)',
        'width:100%','max-width:640px','padding:16px','box-sizing:border-box'
      ].join(';'));
      form.innerHTML = `
        <h4 style="margin:0 0 8px 0; font-size:16px; font-weight:600;">${escapeHtml(title || 'Mode de paiement')}</h4>
        <label style="display:block; margin-bottom:10px;">
          <span style="display:block; font-size:12px; color:#374151;">Nom</span>
          <input type="text" name="nom" value="${escapeHtml(nom)}" required
                 style="margin-top:4px; width:100%; padding:8px; border:1px solid #d1d5db; border-radius:6px; box-sizing:border-box;" />
        </label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <label style="display:block;">
            <span style="display:block; font-size:12px; color:#374151;">Taux (%)</span>
            <input type="number" step="0.01" name="taux" value="${Number(taux_percent||0)}"
                   style="margin-top:4px; width:100%; padding:8px; border:1px solid #d1d5db; border-radius:6px; box-sizing:border-box;" />
          </label>
          <label style="display:block;">
            <span style="display:block; font-size:12px; color:#374151;">Frais fixe (€)</span>
            <input type="number" step="0.01" name="fixe" value="${Number(frais_fixe||0)}"
                   style="margin-top:4px; width:100%; padding:8px; border:1px solid #d1d5db; border-radius:6px; box-sizing:border-box;" />
          </label>
        </div>
        <label style="display:inline-flex; align-items:center; gap:8px; margin-top:10px;">
          <input type="checkbox" name="actif" ${actif ? 'checked' : ''} />
          <span>Actif</span>
        </label>
        <div style="display:flex; justify-content:flex-end; gap:8px; padding-top:10px;">
          <button type="button" data-act="cancel" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; background:#fff; color:#111827; cursor:pointer;">Annuler</button>
          <button type="submit" style="padding:6px 10px; border:1px solid #1d4ed8; background:#2563eb; color:#fff; border-radius:6px; cursor:pointer;">Enregistrer</button>
        </div>`;
      overlay.appendChild(form);
      document.body.appendChild(overlay);

      overlay.querySelector('[data-act="cancel"]').onclick = (e) => { e.preventDefault(); cleanup(); resolve(null); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const data = {
          nom: String(fd.get('nom') || '').trim(),
          taux_percent: Number(fd.get('taux') || 0),
          frais_fixe: Number(fd.get('fixe') || 0),
          actif: fd.get('actif') === 'on',
        };
        if (!data.nom) return; // simple validation
        cleanup();
        resolve(data);
      };
      function cleanup() { overlay.remove(); }
    });
  }
})();
