/**
 * Historique des ventes - Module pour l'onglet Historique
 * Affiche la liste des ventes passées dans le contexte Paramètres > Historique
 */

function eur(v) {
  const n = Number(v || 0);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

async function render() {
  const host = document.getElementById("parametres-souspage");
  if (!host) {
    console.error("Container #parametres-souspage introuvable");
    return;
  }

  try {
    // Récupérer toutes les ventes
    const ventes = await window.electronAPI.getHistoriqueVentes();
    
    if (!Array.isArray(ventes)) {
      throw new Error("Format de données invalide");
    }
    
    // Récupérer les adhérents et modes de paiement pour les filtres
    const adherents = await window.electronAPI.getAdherents() || [];
    const modesPaiement = await window.electronAPI.getModesPaiement() || [];
    
    // Enrichir les données
    const ventesEnrichies = await Promise.all(
      ventes.map(async (v) => {
        const details = await window.electronAPI.getDetailsVente(v.id);
        const header = details.header || details;
        const frais = Number(header.frais_paiement ?? 0) || 0;
        const cotis = Number(header.cotisation ?? 0) || 0;

        let totalProduits = 0;
        if (Array.isArray(details.lignes)) {
          totalProduits = details.lignes.reduce((s, l) => {
            const q = Number(l.quantite || 0);
            const tot = (l.prix != null && l.prix !== '') ? Number(l.prix)
                      : q * Number(l.prix_unitaire || 0);
            return s + (Number.isFinite(tot) ? tot : 0);
          }, 0);
        } else {
          totalProduits = Number(v.total ?? header.total ?? 0) || 0;
        }

        const totalAffiche = totalProduits + cotis + frais;
        const adherentNom = `${header.adherent_nom || ''} ${header.adherent_prenom || ''}`.trim() || '—';

        return {
          id: v.id,
          date_vente: header.date_vente || v.date_vente,
          adherent_id: header.adherent_id,
          adherent_nom: adherentNom,
          mode_paiement_id: header.mode_paiement_id,
          mode_paiement_nom: header.mode_paiement_nom || '—',
          total_affiche: totalAffiche
        };
      })
    );

    // Générer le HTML avec filtres
    host.innerHTML = `
      <div class="historique-container">
        <div class="historique-header">
          <h3>💰 Historique des Ventes</h3>
          <div class="historique-stats">
            <span>Total: <strong id="total-count">${ventesEnrichies.length}</strong> vente(s)</span>
            <span>Montant: <strong id="total-amount">${eur(ventesEnrichies.reduce((s, v) => s + v.total_affiche, 0))}</strong></span>
          </div>
        </div>

        <div class="historique-filters">
          <div class="filter-group">
            <label>🔍 Recherche</label>
            <input type="text" id="filter-search" placeholder="Nom adhérent, mode paiement...">
          </div>
          
          <div class="filter-group">
            <label>📅 Date début</label>
            <input type="date" id="filter-date-start">
          </div>
          
          <div class="filter-group">
            <label>📅 Date fin</label>
            <input type="date" id="filter-date-end">
          </div>
          
          <div class="filter-group">
            <label>👤 Adhérent</label>
            <select id="filter-adherent">
              <option value="">Tous</option>
              ${adherents.map(a => `<option value="${a.id}">${a.nom} ${a.prenom || ''}</option>`).join('')}
            </select>
          </div>
          
          <div class="filter-group">
            <label>💳 Mode paiement</label>
            <select id="filter-mode-paiement">
              <option value="">Tous</option>
              ${modesPaiement.map(m => `<option value="${m.id}">${m.nom}</option>`).join('')}
            </select>
          </div>
          
          <button class="btn-reset-filters" id="btn-reset">🔄 Réinitialiser</button>
        </div>

        ${ventesEnrichies.length === 0 
          ? '<p class="no-data">Aucune vente enregistrée.</p>'
          : `
            <div class="table-responsive">
              <table class="table historique-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Adhérent</th>
                    <th>Total</th>
                    <th>Paiement</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${ventesEnrichies.map(v => renderVenteRow(v)).join("")}
                </tbody>
              </table>
            </div>
          `
        }
      </div>

      <div id="facture-popup" class="modal-overlay" style="display:none;">
        <div class="modal-content" style="max-width: 900px;">
          <div class="modal-header">
            <h3>Détail de la vente</h3>
            <button class="modal-close" onclick="document.getElementById('facture-popup').style.display='none'">×</button>
          </div>
          <div class="modal-body" id="facture-detail"></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('facture-popup').style.display='none'">Fermer</button>
          </div>
        </div>
      </div>

      ${getStyles()}
    `;

    // Attacher les event listeners après que le DOM soit complètement rendu
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        attachEventListenersVentes(ventesEnrichies);
      });
    });

  } catch (error) {
    console.error("Erreur lors du chargement de l'historique des ventes:", error);
    host.innerHTML = `
      <div class="error-message">
        <p>❌ Erreur lors du chargement des ventes</p>
        <p>${error.message || "Erreur inconnue"}</p>
      </div>
    `;
  }
}

function renderVenteRow(vente) {
  const date = vente.date_vente 
    ? new Date(vente.date_vente).toLocaleString('fr-FR')
    : '-';

  return `
    <tr class="data-row" 
        data-vente-id="${vente.id}"
        data-date="${vente.date_vente}"
        data-adherent-id="${vente.adherent_id || ''}"
        data-adherent-nom="${vente.adherent_nom.toLowerCase()}"
        data-mode-paiement-id="${vente.mode_paiement_id || ''}"
        data-mode-paiement-nom="${vente.mode_paiement_nom.toLowerCase()}"
        data-total="${vente.total_affiche}">
      <td>${date}</td>
      <td>${vente.adherent_nom}</td>
      <td>${eur(vente.total_affiche)}</td>
      <td>${vente.mode_paiement_nom}</td>
      <td>
        <button class="action-btn btn-view" data-action="view" data-id="${vente.id}">
          👁️ Voir
        </button>
      </td>
    </tr>
  `;
}

// Handler nommé pour pouvoir le retirer
let ventesClickHandler = null;

function attachEventListenersVentes(allVentes) {
  const host = document.getElementById("parametres-souspage");
  
  // Retirer l'ancien handler s'il existe
  if (ventesClickHandler) {
    host.removeEventListener('click', ventesClickHandler);
  }
  
  // Créer et attacher le nouveau handler
  ventesClickHandler = async (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    
    // Vérifier qu'on est bien dans le contexte des ventes (pas réceptions)
    // En vérifiant si l'élément facture-popup existe
    const facturePopup = document.getElementById('facture-popup');
    if (!facturePopup) return; // Pas dans la page ventes

    const action = btn.dataset.action;
    const venteId = parseInt(btn.dataset.id);

    if (action === 'view') {
      await viewVente(venteId);
    }
  };
  
  host.addEventListener('click', ventesClickHandler);
  
  // Filtres
  const filterSearch = document.getElementById('filter-search');
  const filterDateStart = document.getElementById('filter-date-start');
  const filterDateEnd = document.getElementById('filter-date-end');
  const filterAdherent = document.getElementById('filter-adherent');
  const filterModePaiement = document.getElementById('filter-mode-paiement');
  const btnReset = document.getElementById('btn-reset');
  
  // Vérifier que tous les éléments existent
  if (!filterSearch || !filterDateStart || !filterDateEnd || !filterAdherent || !filterModePaiement || !btnReset) {
    console.error('Certains éléments de filtre sont introuvables');
    return;
  }
  
  function applyFilters() {
    const search = filterSearch.value.toLowerCase().trim();
    const dateStart = filterDateStart.value ? new Date(filterDateStart.value) : null;
    const dateEnd = filterDateEnd.value ? new Date(filterDateEnd.value) : null;
    const adherentId = filterAdherent.value;
    const modePaiementId = filterModePaiement.value;
    
    const rows = document.querySelectorAll('.data-row');
    let visibleCount = 0;
    let visibleTotal = 0;
    
    rows.forEach(row => {
      let visible = true;
      
      // Recherche textuelle
      if (search && !row.dataset.adherentNom.includes(search) && !row.dataset.modePaiementNom.includes(search)) {
        visible = false;
      }
      
      // Date début
      if (visible && dateStart) {
        const rowDate = new Date(row.dataset.date);
        if (rowDate < dateStart) visible = false;
      }
      
      // Date fin
      if (visible && dateEnd) {
        const rowDate = new Date(row.dataset.date);
        if (rowDate > dateEnd) visible = false;
      }
      
      // Adhérent
      if (visible && adherentId && row.dataset.adherentId !== adherentId) {
        visible = false;
      }
      
      // Mode paiement
      if (visible && modePaiementId && row.dataset.modePaiementId !== modePaiementId) {
        visible = false;
      }
      
      row.style.display = visible ? '' : 'none';
      if (visible) {
        visibleCount++;
        visibleTotal += parseFloat(row.dataset.total);
      }
    });
    
    document.getElementById('total-count').textContent = visibleCount;
    document.getElementById('total-amount').textContent = eur(visibleTotal);
  }
  
  // Debounce pour la recherche
  let debounceTimer;
  filterSearch.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 300);
  });
  
  filterDateStart.addEventListener('change', applyFilters);
  filterDateEnd.addEventListener('change', applyFilters);
  filterAdherent.addEventListener('change', applyFilters);
  filterModePaiement.addEventListener('change', applyFilters);
  
  btnReset.addEventListener('click', () => {
    filterSearch.value = '';
    filterDateStart.value = '';
    filterDateEnd.value = '';
    filterAdherent.value = '';
    filterModePaiement.value = '';
    applyFilters();
  });
}

async function viewVente(venteId) {
  try {
    const details = await window.electronAPI.getDetailsVente(venteId);
    const header = details.header || details;
    const lignes = details.lignes || [];

    const montantCotisation = Number(header.cotisation || 0);
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
      const q = Number(l.quantite || 0);
      const tot = (l.prix != null && l.prix !== '')
        ? Number(l.prix)
        : Number(q) * Number(l.prix_unitaire || 0);
      return s + (Number.isFinite(tot) ? tot : 0);
    }, 0);
    const totalGlobal = totalProduits + montantCotisation + fraisPaiement;

    const html = `
      <h3>Détail de la vente #${venteId}</h3>
      <div class="reception-details">
        <div class="detail-row">
          <strong>Date :</strong> ${new Date(header.date_vente).toLocaleString('fr-FR')}
        </div>
        <div class="detail-row">
          <strong>Adhérent :</strong> ${(header.adherent_nom || '')} ${(header.adherent_prenom || '')}
        </div>
        <div class="detail-row">
          <strong>Mode de paiement :</strong> ${header.mode_paiement_nom || '—'}
        </div>
      </div>
      
      <h4 style="margin-top: 20px;">Produits vendus:</h4>
      <table class="table" style="margin-top: 10px;">
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
              <td>${eur(l.puOrig)}</td>
              <td>${l.remise.toFixed(2)} %</td>
              <td>${eur(l.puRemise)}</td>
              <td>${eur(l.lineTotal)}</td>
            </tr>
          `).join('')}
          ${montantCotisation > 0 ? `
            <tr style="background: #f0f8ff;">
              <td colspan="5"><em>Cotisation</em></td>
              <td>${eur(montantCotisation)}</td>
            </tr>
          ` : ''}
          ${fraisPaiement > 0 ? `
            <tr style="background: #f0f8ff;">
              <td colspan="5"><em>Frais de paiement</em></td>
              <td>${eur(fraisPaiement)}</td>
            </tr>
          ` : ''}
          <tr style="background: #e8f5e9; font-weight: bold;">
            <td colspan="5">TOTAL</td>
            <td>${eur(totalGlobal)}</td>
          </tr>
        </tbody>
      </table>
    `;
    
    document.getElementById('facture-detail').innerHTML = html;
    document.getElementById('facture-popup').style.display = 'flex';
    
  } catch (error) {
    console.error("Erreur lors de l'affichage de la vente:", error);
    window.showError?.("Erreur lors du chargement des détails");
  }
}

function getStyles() {
  return `
    <style>
      .historique-container {
        padding: 15px;
      }
      
      .historique-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        padding-bottom: 15px;
        border-bottom: 2px solid #e0e0e0;
      }
      
      .historique-header h3 {
        margin: 0;
        color: #333;
        font-size: 1.5rem;
      }
      
      .historique-stats {
        display: flex;
        gap: 20px;
        font-size: 0.95rem;
        color: #666;
      }
      
      .historique-stats strong {
        color: #2196F3;
        font-size: 1.1rem;
      }
      
      .historique-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
        align-items: flex-end;
      }
      
      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      
      .filter-group label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #666;
      }
      
      .filter-group input,
      .filter-group select {
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 0.9rem;
        min-width: 150px;
      }
      
      .filter-group input:focus,
      .filter-group select:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
      }
      
      .btn-reset-filters {
        padding: 8px 16px;
        background: #6c757d;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: background 0.2s;
      }
      
      .btn-reset-filters:hover {
        background: #5a6268;
      }
      
      .no-data {
        text-align: center;
        padding: 40px;
        color: #999;
        font-style: italic;
      }
      
      .table-responsive {
        overflow-x: auto;
        margin-top: 15px;
      }
      
      .historique-table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      
      .historique-table thead {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      
      .historique-table th {
        padding: 12px;
        text-align: left;
        font-weight: 600;
        font-size: 0.9rem;
        white-space: nowrap;
      }
      
      .historique-table td {
        padding: 10px 12px;
        border-bottom: 1px solid #f0f0f0;
        font-size: 0.9rem;
      }
      
      .historique-table tbody tr:hover {
        background-color: #f8f9ff;
      }
      
      .action-btn {
        padding: 5px 12px;
        margin: 0 3px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
        transition: all 0.2s;
      }
      
      .btn-view {
        background: #2196F3;
        color: white;
      }
      
      .btn-view:hover {
        background: #1976D2;
      }
      
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }
      
      .modal-content {
        background: white;
        border-radius: 8px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      }
      
      .modal-header {
        padding: 20px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .modal-header h3 {
        margin: 0;
      }
      
      .modal-close {
        background: none;
        border: none;
        font-size: 2rem;
        cursor: pointer;
        color: #999;
      }
      
      .modal-close:hover {
        color: #333;
      }
      
      .modal-body {
        padding: 20px;
      }
      
      .modal-footer {
        padding: 15px 20px;
        border-top: 1px solid #e0e0e0;
        text-align: right;
      }
      
      .reception-details {
        background: #f8f9fa;
        padding: 15px;
        border-radius: 6px;
      }
      
      .detail-row {
        padding: 8px 0;
        border-bottom: 1px solid #e0e0e0;
      }
      
      .detail-row:last-child {
        border-bottom: none;
      }
      
      .detail-row strong {
        display: inline-block;
        width: 150px;
        color: #666;
      }
      
      .error-message {
        padding: 20px;
        text-align: center;
        color: #d32f2f;
      }
    </style>
  `;
}

// Exporter les fonctions
window.PageParamsHistoriqueVentes = {
  render
};
