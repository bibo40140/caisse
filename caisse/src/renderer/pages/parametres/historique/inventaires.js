/**
 * Historique des inventaires - Module pour l'onglet Historique
 * Affiche la liste des sessions d'inventaire dans le contexte Paramètres > Historique
 */

(function () {
// --- Busy helpers (no-op si absents) ---
const showBusy = (m) => (typeof window.showBusy === 'function' ? window.showBusy(m) : void 0);
const hideBusy = () => (typeof window.hideBusy === 'function' ? window.hideBusy() : void 0);

// --- UI helpers ---
function formatEUR(v) {
  const n = Number(v || 0);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

  // --- CSV helper ---
  function toCSV(rows) {
    const esc = (v) => {
      const s = String(v ?? '');
      return (/[",;\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['produit_id','nom','code_barre','stock_start','counted_total','ecart','prix','valeur_comptee'];
    const body = (rows || []).map(r => {
      const start   = Number(r.stock_start || 0);
      const counted = Number(r.counted_total || 0);
      const delta   = counted - start;
      const price   = Number(r.prix || 0);
      const val     = counted * price;
      return [
        r.produit_id,
        r.nom || '',
        r.code_barre || '',
        start,
        counted,
        delta,
        price.toFixed(2),
        val.toFixed(2)
      ].map(esc).join(';');
    });
    return [header.join(';'), ...body].join('\n');
  }

  // --- IPC wrappers (via preload) ---
  async function listSessionsIPC() {
    // Retourne un tableau de sessions [{ id, name, started_at, ended_at, status, counted_lines, total_products, inventory_value }, ...]
    const list = await window.electronAPI?.inventory?.listSessions?.();
    return Array.isArray(list) ? list : [];
  }

  async function getSummaryIPC(sessionId) {
    // Retour brut de l’API via main: { ok, session, lines: [...] }
    const js = await window.electronAPI?.inventory?.getSummary?.(sessionId);
    if (!js || js.ok === false) throw new Error(js?.error || 'Résumé indisponible');
    return js;
  }

async function showDetailModal(sessionId) {
  showBusy('Chargement du détail…');
  try {
    const js = await window.electronAPI.inventory.getSummary(sessionId);
    const lines = js.lines || [];
    const sess  = js.session || {};
      const date  = sess.started_at ? new Date(sess.started_at).toLocaleString() : '—';

      const invValue = lines.reduce((acc, r) => acc + Number(r.counted_total || 0) * Number(r.prix || 0), 0);
      const counted  = lines.filter(r => Number(r.counted_total || 0) !== 0).length;

      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `
        <div class="modal" style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14px; max-width:95vw; max-height:90vh; overflow:auto;">
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
                const start   = Number(r.stock_start || 0);
                const counted = Number(r.counted_total || 0);
                const delta   = counted - start;
                const price   = Number(r.prix || 0);
                const val     = counted * price;
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
    alert('Erreur de chargement : ' + (e?.message || e));
  } finally {
    hideBusy();
  }
}

async function exportCSV(sessionId) {
  showBusy('Préparation du CSV…');
  try {
    const js = await window.electronAPI.inventory.getSummary(sessionId);
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
    hideBusy();
  }
}

  async function render() {
    const container = document.getElementById('parametres-souspage') || document.getElementById('page-content');

    showBusy('Chargement des sessions…');
    try {
      const sessions = await listSessionsIPC();

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
          const id = btn.dataset.id; // UUID string, pas Number
          await showDetailModal(id);
        });
      });
      container.querySelectorAll('.btn-csv').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id; // UUID string, pas Number
          await exportCSV(id);
        });
      });

    } catch (e) {
      container.innerHTML = `<p>Erreur: ${e?.message || e}</p>`;
    } finally {
      hideBusy();
    }
  }

  window.PageParamsHistoriqueInventaires = { render };
})();
