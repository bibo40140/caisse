(() => {
  async function renderHistoriqueFactures() {
    const container = document.getElementById('page-content');
    if (!container) return;

    const ventes = await window.electronAPI.getHistoriqueVentes();
    const ventesAvecProduits = await Promise.all(
      ventes.map(async (v) => {
        const details = await window.electronAPI.getDetailsVente(v.id);
        const header  = details.header || details;
        const lignes  = details.lignes || [];
        const totalProduits = Number(v.total ?? header.total ?? 0);
        const frais         = Number(v.frais_paiement ?? header.frais_paiement ?? 0) || 0;
        const cotisation    = Number(v.cotisation    ?? header.cotisation    ?? 0) || 0;
        const totalAffiche  = totalProduits + cotisation + frais;
        const adherent = `${v.adherent_nom || header.adherent_nom || ''} ${v.adherent_prenom || header.adherent_prenom || ''}`.trim();
        return { vente_id: v.id, date_vente: v.date_vente, adherent, mode_paiement_nom: (v.mode_paiement_nom || header.mode_paiement_nom || '—'), total_affiche: totalAffiche };
      })
    );

    container.innerHTML = `
      <h2>Historique des ventes</h2>
      <input type="text" id="recherche-vente"
        placeholder="Rechercher…"
        style="margin-bottom: 10px; width: 100%;">

      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Adhérent</th>
            <th>Total</th>
            <th>Paiement</th>
            <th>Détail</th>
          </tr>
        </thead>
        <tbody id="ventes-tbody">
          ${ventesAvecProduits.map(v => `
            <tr>
              <td>${new Date(v.date_vente).toLocaleString()}</td>
              <td>${v.adherent || '—'}</td>
              <td>${v.total_affiche.toFixed(2)} €</td>
              <td>${v.mode_paiement_nom || '—'}</td>
              <td><button data-id="${v.vente_id}" class="btn voir-detail-btn">Voir</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div id="facture-popup" class="modal-overlay" style="display:none;">
        <div class="modal">
          <div id="facture-detail"></div>
          <div style="text-align: right; margin-top: 10px;">
            <button id="btn-fermer-facture" class="btn">Fermer</button>
          </div>
        </div>
      </div>
    `;

    const input = document.getElementById('recherche-vente');
    const rows = Array.from(document.querySelectorAll('#ventes-tbody tr'));
    let debounce;
    input.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        rows.forEach(tr => {
          const idx = (tr.textContent || '').toLowerCase();
          tr.style.display = idx.includes(q) ? '' : 'none';
        });
      }, 80);
    });

    document.querySelectorAll('.voir-detail-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const details = await window.electronAPI.getDetailsVente(id);
        const header = details.header || details;
        const lignes = details.lignes || [];

        const montantCotisation = Number(header.cotisation || details.cotisation || 0);
        const fraisPaiement = Number(header.frais_paiement || 0);

        const lignesCalc = lignes.map(l => {
          const q = Number(l.quantite || 0);
          const lineTotal = (l.prix != null && l.prix !== '')
            ? Number(l.prix)
            : Number(q) * Number(l.prix_unitaire || 0);
          const puOrig = (l.prix_unitaire != null && l.prix_unitaire !== '')
            ? Number(l.prix_unitaire)
            : (q > 0 ? lineTotal / q : 0);
          const remise = Number(l.remise_percent || 0);
          const puRemise = puOrig * (1 - remise / 100);
          return { produit_nom: l.produit_nom || '', qte: q, puOrig, remise, puRemise, lineTotal };
        });

        const totalProduits = lignes.reduce((s, l) => {
          const q   = Number(l.quantite || 0);
          const tot = (l.prix != null && l.prix !== '')
            ? Number(l.prix)
            : Number(q) * Number(l.prix_unitaire || 0);
          return s + (Number.isFinite(tot) ? tot : 0);
        }, 0);
        const totalGlobal   = totalProduits + montantCotisation + fraisPaiement;

        const html = `
          <h3>Détail de la vente #${id}</h3>
          <p><strong>Date :</strong> ${new Date(header.date_vente).toLocaleString()}</p>
          <p><strong>Adhérent :</strong> ${(header.adherent_nom || '')} ${(header.adherent_prenom || '')}</p>
          <p><strong>Mode de paiement :</strong> ${header.mode_paiement_nom || '—'}</p>
          <table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse: collapse;">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Qté</th>
                <th>PU</th>
                <th>Remise</th>
                <th>PU remisé</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${lignesCalc.map(l => `
                <tr>
                  <td>${l.produit_nom}</td>
                  <td>${l.qte}</td>
                  <td>${l.puOrig.toFixed(2)} €</td>
                  <td>${l.remise.toFixed(2)} %</td>
                  <td>${l.puRemise.toFixed(2)} €</td>
                  <td>${l.lineTotal.toFixed(2)} €</td>
                </tr>
              `).join('')}
              ${montantCotisation > 0 ? `
                <tr>
                  <td><em>Cotisation</em></td>
                  <td>—</td>
                  <td colspan="3">${montantCotisation.toFixed(2)} €</td>
                  <td>${montantCotisation.toFixed(2)} €</td>
                </tr>
              ` : ''}
              ${fraisPaiement > 0 ? `
                <tr>
                  <td><em>Frais de paiement</em></td>
                  <td>—</td>
                  <td colspan="3">${fraisPaiement.toFixed(2)} €</td>
                  <td>${fraisPaiement.toFixed(2)} €</td>
                </tr>
              ` : ''}
            </tbody>
          </table>
          <p style="margin-top: 10px;">
            <strong>Total produits :</strong> ${totalProduits.toFixed(2)} €<br>
            ${fraisPaiement > 0 ? `<strong>Frais de paiement :</strong> ${fraisPaiement.toFixed(2)} €<br>` : ''}
            ${montantCotisation > 0 ? `<strong>Cotisation :</strong> ${montantCotisation.toFixed(2)} €<br>` : ''}
            <strong>Total :</strong> ${totalGlobal.toFixed(2)} €<br>
          </p>
        `;
        document.getElementById('facture-detail').innerHTML = html;
        document.getElementById('facture-popup').style.display = 'flex';
      });
    });

    document.getElementById('btn-fermer-facture').addEventListener('click', () => {
      const popup = document.getElementById('facture-popup');
      if (popup) popup.style.display = 'none';
    });
  }

  window.PageParams = { ...(window.PageParams||{}), renderHistoriqueFactures };
})();