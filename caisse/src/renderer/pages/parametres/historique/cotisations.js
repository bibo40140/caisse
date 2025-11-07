// src/renderer/pages/parametres/historique/cotisations.js
(() => {
  if (!document.getElementById('hist-coti-style')) {
    const st = document.createElement('style');
    st.id = 'hist-coti-style';
    st.textContent = `
      .coti-wrap .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); }
      .coti-wrap .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
      .coti-wrap .row { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
      .coti-wrap label { font-weight:600; font-size:12px; }
      .coti-wrap input, .coti-wrap select { width:100%; padding:6px 8px; }
      .coti-table { width:100%; border-collapse: collapse; margin-top:10px; }
      .coti-table th, .coti-table td { border-bottom:1px solid #eee; padding:8px; text-align:left; }
      .muted { color:#6b7280; font-size:12px; }
      @media (max-width: 1100px) {
        .coti-wrap .grid { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 680px) {
        .coti-wrap .grid { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(st);
  }

  function toISODate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0,10);
  }

  function exportCSV(rows) {
    const headers = ['Date', 'Adhérent', 'Montant (€)', 'Commentaire', 'ID'];
    const lines = [headers.join(';')];
    rows.forEach(r => {
      const line = [
        r.date || '',
        (r.adherent_nom || r.adherent || '').replace(/;/g, ','),
        String(r.montant ?? ''),
        (r.commentaire || '').replace(/;/g, ','),
        r.id ?? ''
      ].join(';');
      lines.push(line);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = toISODate(new Date());
    a.download = `cotisations_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function render() {
    const host = document.getElementById('parametres-souspage');
    if (!host) return;

    host.innerHTML = `
      <div class="coti-wrap">
        <div class="card">
          <h3 style="margin-top:0;">Historique des cotisations</h3>
          <div class="grid">
            <div>
              <label>Période — du</label>
              <input type="date" id="coti-from" />
            </div>
            <div>
              <label>Période — au</label>
              <input type="date" id="coti-to" />
            </div>
            <div>
              <label>Adhérent</label>
              <select id="coti-adherent">
                <option value="">— Tous —</option>
              </select>
            </div>
            <div>
              <label>Montant min (€)</label>
              <input type="number" id="coti-min" step="0.01" />
            </div>
          </div>
          <div class="row" style="margin-top:10px;">
            <button id="coti-apply" class="btn">Filtrer</button>
            <button id="coti-reset" class="btn">Réinitialiser</button>
            <button id="coti-export" class="btn">Exporter CSV</button>
            <span id="coti-msg" class="muted"></span>
          </div>
        </div>

        <div class="card" style="margin-top:12px;">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div class="muted" id="coti-count">0 résultat</div>
          </div>
          <table class="coti-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Adhérent</th>
                <th>Montant (€)</th>
                <th>Commentaire</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody id="coti-body">
              <tr><td colspan="5" class="muted">Chargement…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const $ = (sel) => host.querySelector(sel);

    // 1) Charger adhérents pour le filtre
    try {
const adhs = await window.electronAPI.getAdherents?.(0);      const select = $('#coti-adherent');
      if (Array.isArray(adhs)) {
        adhs.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.nom ? `${a.prenom ? a.prenom + ' ' : ''}${a.nom}` : (a.display_name || `#${a.id}`);
          select.appendChild(opt);
        });
      }
    } catch {}

    // 2) Charger cotisations
    let allRows = [];
    try {
      const rows = await window.electronAPI.getCotisations?.();
      allRows = Array.isArray(rows) ? rows.map(r => ({
        id: r.id ?? r.cotisation_id ?? r._id,
        date: r.date_paiement || r.date || r.created_at || '',
        adherent_id: r.adherent_id ?? r.adherentId ?? null,
        adherent: r.adherent || '',
        adherent_nom: r.adherent_nom || r.nom || r.name || '',
        montant: Number(r.montant ?? r.amount ?? 0),
        commentaire: r.commentaire || r.note || '',
      })) : [];
    } catch (e) {
      $('#coti-body').innerHTML = `<tr><td colspan="5" class="muted">Erreur: ${e?.message || e}</td></tr>`;
      return;
    }

    function applyFilters() {
      const dFrom = $('#coti-from').value ? new Date($('#coti-from').value) : null;
      const dTo   = $('#coti-to').value   ? new Date($('#coti-to').value)   : null;
      const adhId = $('#coti-adherent').value;
      const min   = $('#coti-min').value ? Number($('#coti-min').value) : null;

      let out = allRows.slice();

      if (dFrom) {
        out = out.filter(r => {
          const d = new Date(r.date);
          return !Number.isNaN(d.getTime()) && d >= dFrom;
        });
      }
      if (dTo) {
        // inclure la journée complète
        const d2 = new Date(dTo.getTime());
        d2.setDate(d2.getDate() + 1);
        out = out.filter(r => {
          const d = new Date(r.date);
          return !Number.isNaN(d.getTime()) && d < d2;
        });
      }
      if (adhId) {
        out = out.filter(r => String(r.adherent_id) === String(adhId));
      }
      if (min != null && !Number.isNaN(min)) {
        out = out.filter(r => Number(r.montant) >= min);
      }

      // tri récent → ancien
      out.sort((a, b) => new Date(b.date) - new Date(a.date));
      return out;
    }

    function renderTable(rows) {
      const body = $('#coti-body');
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="5" class="muted">Aucun résultat.</td></tr>`;
      } else {
        body.innerHTML = rows.map(r => `
          <tr>
            <td>${toISODate(r.date) || ''}</td>
            <td>${(r.adherent_nom || r.adherent || '').toString().replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</td>
            <td>${(Number(r.montant) || 0).toFixed(2)}</td>
            <td>${(r.commentaire || '').toString().replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</td>
            <td>${r.id ?? ''}</td>
          </tr>
        `).join('');
      }
      $('#coti-count').textContent = `${rows.length} résultat${rows.length>1?'s':''}`;
    }

    // actions
    $('#coti-apply').addEventListener('click', () => {
      const rows = applyFilters();
      renderTable(rows);
    });
    $('#coti-reset').addEventListener('click', () => {
      $('#coti-from').value = '';
      $('#coti-to').value = '';
      $('#coti-adherent').value = '';
      $('#coti-min').value = '';
      renderTable(applyFilters());
    });
    $('#coti-export').addEventListener('click', () => {
      exportCSV(applyFilters());
    });

    // première vue
    renderTable(applyFilters());
  }

  window.PageParamsHistoriqueCotisations = { render };
})();
