(() => {
  const { get: getApiBase } = window.ApiBase || { get: async () => '' };
  const { formatEUR } = window.Currency || { formatEUR: (x)=>String(x) };

  async function fetchInventorySummary(apiBase, sessionId) {
    const r = await fetch(`${apiBase}/inventory/${sessionId}/summary`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const js = await r.json();
    if (!js?.ok) throw new Error(js?.error || 'Réponse invalide');
    return js;
  }
  function toCSV(rows) {
    const esc = (v) => { const s = String(v ?? ''); return (/[",;\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['product_id','nom','code_barre','stock_start','counted_total','ecart','prix','valeur_comptee'];
    const body = rows.map(r => {
      const start = Number(r.stock_start || 0);
      const counted = Number(r.counted_total || 0);
      const delta = counted - start;
      const price = Number(r.prix || 0);
      const val = counted * price;
      return [ r.product_id, r.nom || '', r.code_barre || '', start, counted, delta, price.toFixed(2), val.toFixed(2) ].map(esc).join(';');
    });
    return [header.join(';'), ...body].join('\n');
  }
  async function showInventoryDetailModal(apiBase, sessionId) {
    window.UIBusy?.showBusy('Chargement du détail…');
    try {
      const js = await fetchInventorySummary(apiBase, sessionId);
      const lines = js.lines || [];
      const sess  = js.session || {};
      const date  = sess.started_at ? new Date(sess.started_at).toLocaleString() : '—';

      const invValue = lines.reduce((acc, r) => acc + Number(r.counted_total || 0) * Number(r.prix || 0), 0);
      const counted  = lines.filter(r => Number(r.counted_total || 0) !== 0).length;

      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <div class="modal" style="background:#fff; border-radius:10px; padding:14px; max-width:95vw; max-height:90vh; overflow:auto;">
          <h3 style="margin-top:0;">Inventaire #${sessionId} — ${sess.name || ''}</h3>
          <div style="margin-bottom:8px; color:#555;">
            Date : <strong>${date}</strong> — Produits inventoriés : <strong>${counted}</strong> — Valeur : <strong>${formatEUR(invValue)}</strong>
          </div>
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Produit</th><th>Code</th><th>Stock initial</th><th>Compté</th><th>Écart</th><th>Prix</th><th>Valeur comptée</th>
              </tr>
            </thead>
            <tbody>
              ${lines.map(r => {
                const start = Number(r.stock_start || 0);
                const counted = Number(r.counted_total || 0);
                const delta = counted - start;
                const price = Number(r.prix || 0);
                const val = counted * price;
                return `
                  <tr>
                    <td>${r.nom || ''}</td>
                    <td>${r.code_barre || ''}</td>
                    <td>${start}</td>
                    <td>${counted}</td>
                    <td>${delta > 0 ? '+' : ''}${delta}</td>
                    <td>${formatEUR(price)}</td>
                    <td>${formatEUR(val)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div style="text-align:right; margin-top:10px;">
            <button class="btn modal-close">Fermer</button>
          </div>
        </div>
        <style>.modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:9999; }</style>
      `;
      document.body.appendChild(wrap);
      wrap.querySelector('.modal-close').addEventListener('click', () => wrap.remove());
      wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    } catch (e) {
      alert('Erreur: ' + (e?.message || e));
    } finally {
      window.UIBusy?.hideBusy();
    }
  }
  async function exportInventoryCSV(apiBase, sessionId) {
    window.UIBusy?.showBusy('Préparation du CSV…');
    try {
      const js = await fetchInventorySummary(apiBase, sessionId);
      const csv = toCSV(js.lines || []);
      const name = (js.session?.name || `inventaire-${sessionId}`).replace(/[^\w\-]+/g, '_');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export CSV impossible : ' + (e?.message || e));
    } finally {
      window.UIBusy?.hideBusy();
    }
  }

  async function renderHistoriqueInventaires() {
    const container = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    const apiBase = await getApiBase();
    if (!apiBase) {
      container.innerHTML = `<p>API non configurée (paramètre <code>api_base_url</code> manquant).</p>`;
      return;
    }
    window.UIBusy?.showBusy('Chargement des sessions…');
    try {
      const r = await fetch(`${apiBase}/inventory/sessions`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const js = await r.json();
      if (!js?.ok) throw new Error(js?.error || 'Réponse invalide');
      const sessions = js.sessions || [];

      container.innerHTML = `
        <h3>Historique des inventaires</h3>
        <table class="table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr>
              <th>Nom</th><th>Début</th><th>Fin</th><th>Statut</th><th>Comptés / Total</th><th>Valeur inventaire</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${sessions.map(s => `
              <tr data-id="${s.id}">
                <td>${s.name || '—'}</td>
                <td>${s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
                <td>${s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}</td>
                <td>${s.status}</td>
                <td>${s.counted_lines}/${s.total_products}</td>
                <td>${formatEUR(s.inventory_value)}</td>
                <td>
                  <button class="btn btn-see" data-id="${s.id}">Voir</button>
                  <button class="btn btn-csv" data-id="${s.id}">CSV</button>
                </td>
              </tr>
            `).join('')}
            ${sessions.length === 0 ? `<tr><td colspan="7">Aucune session.</td></tr>` : ''}
          </tbody>
        </table>
      `;

      container.querySelectorAll('.btn-see').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          await showInventoryDetailModal(apiBase, id);
        });
      });
      container.querySelectorAll('.btn-csv').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          await exportInventoryCSV(apiBase, id);
        });
      });

    } catch (e) {
      container.innerHTML = `<p>Erreur: ${e?.message || e}</p>`;
    } finally {
      window.UIBusy?.hideBusy();
    }
  }

  window.PageParams = { ...(window.PageParams||{}), renderHistoriqueInventaires };
})();