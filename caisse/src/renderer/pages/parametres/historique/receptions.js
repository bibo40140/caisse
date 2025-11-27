/**
 * Historique des réceptions - Module pour l'onglet Historique
 * Affiche la liste des réceptions passées dans le contexte Paramètres > Historique
 */

async function render() {
  const host = document.getElementById("parametres-souspage");
  if (!host) {
    console.error("Container #parametres-souspage introuvable");
    return;
  }

  try {
    // Récupérer toutes les réceptions depuis l'API (avec limite élevée pour avoir tout l'historique)
    const receptions = await window.api.invoke("receptions:list", { limit: 10000, offset: 0 });
    
    if (!Array.isArray(receptions)) {
      throw new Error("Format de données invalide");
    }
    
    // Récupérer la liste des fournisseurs pour les filtres
    const fournisseurs = await window.electronAPI.getFournisseurs() || [];

    // Générer le HTML avec filtres
    host.innerHTML = `
      <div class="historique-container">
        <div class="historique-header">
          <h3>📥 Historique des Réceptions</h3>
          <div class="historique-stats">
            <span>Total: <strong id="total-count">${receptions.length}</strong> réception(s)</span>
            <span>Montant: <strong id="total-amount">${receptions.reduce((sum, r) => sum + (parseFloat(r.montant_total) || 0), 0).toFixed(2)} €</strong></span>
          </div>
        </div>

        <div class="historique-filters">
          <div class="filter-group">
            <label>🔍 Recherche</label>
            <input type="text" id="filter-search" placeholder="Numéro de facture, fournisseur...">
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
            <label>🏢 Fournisseur</label>
            <select id="filter-fournisseur">
              <option value="">Tous</option>
              ${fournisseurs.map(f => `<option value="${f.id}">${f.nom}</option>`).join('')}
            </select>
          </div>
          
          <button class="btn-reset-filters" id="btn-reset">🔄 Réinitialiser</button>
        </div>

        ${receptions.length === 0 
          ? '<p class="no-data">Aucune réception enregistrée.</p>'
          : `
            <div class="table-responsive">
              <table class="table historique-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Fournisseur</th>
                    <th>Référence</th>
                    <th>Montant</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${receptions.map(r => renderReceptionRow(r)).join("")}
                </tbody>
              </table>
            </div>
          `
        }
      </div>

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
        
        .status-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 0.8rem;
          font-weight: 600;
        }
        
        .status-validated {
          background: #e8f5e9;
          color: #2e7d32;
        }
        
        .status-pending {
          background: #fff3e0;
          color: #ef6c00;
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
        
        .btn-edit {
          background: #FF9800;
          color: white;
        }
        
        .btn-edit:hover {
          background: #F57C00;
        }
      </style>
    `;

    // Attacher les event listeners après que le DOM soit complètement rendu
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        attachEventListenersReceptions(receptions);
      });
    });

  } catch (error) {
    console.error("Erreur lors du chargement de l'historique des réceptions:", error);
    host.innerHTML = `
      <div class="error-message">
        <p>❌ Erreur lors du chargement des réceptions</p>
        <p>${error.message || "Erreur inconnue"}</p>
      </div>
    `;
  }
}

/**
 * Génère une ligne de tableau pour une réception
 */
function renderReceptionRow(reception) {
  const date = reception.date 
    ? new Date(reception.date).toLocaleDateString('fr-FR')
    : '-';
  
  const fournisseur = reception.fournisseur || 'Sans fournisseur';
  const reference = reception.reference || '—';
  const montant = reception.montant_total 
    ? parseFloat(reception.montant_total).toFixed(2) + ' €'
    : '0.00 €';

  return `
    <tr class="data-row" 
        data-reception-id="${reception.id}"
        data-date="${reception.date}"
        data-fournisseur-id="${reception.fournisseur_id || ''}"
        data-fournisseur-nom="${fournisseur.toLowerCase()}"
        data-reference="${reference.toLowerCase()}"
        data-montant="${reception.montant_total || 0}">
      <td>${date}</td>
      <td>${fournisseur}</td>
      <td>${reference}</td>
      <td style="text-align: right; font-weight: 600;">${montant}</td>
      <td>
        <button class="action-btn btn-view" data-action="view" data-id="${reception.id}">
          👁️ Voir
        </button>
      </td>
    </tr>
  `;
}

// Handler nommé pour pouvoir le retirer
let receptionsClickHandler = null;

/**
 * Attache les événements
 */
function attachEventListenersReceptions(allReceptions) {
  const host = document.getElementById("parametres-souspage");
  
  // Retirer l'ancien handler s'il existe
  if (receptionsClickHandler) {
    host.removeEventListener('click', receptionsClickHandler);
  }
  
  // Créer et attacher le nouveau handler
  receptionsClickHandler = async (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    
    // Vérifier qu'on est bien dans le contexte des réceptions
    // En vérifiant la présence du tableau des réceptions
    const receptionsTable = document.querySelector('.historique-table');
    const hasReceptionData = receptionsTable && receptionsTable.querySelector('[data-fournisseur-id]');
    if (!hasReceptionData) return; // Pas dans la page réceptions ou pas de données

    const action = btn.dataset.action;
    const receptionId = parseInt(btn.dataset.id);

    if (action === 'view') {
      await viewReception(receptionId);
    }
  };
  
  host.addEventListener('click', receptionsClickHandler);
  
  // Filtres
  const filterSearch = document.getElementById('filter-search');
  const filterDateStart = document.getElementById('filter-date-start');
  const filterDateEnd = document.getElementById('filter-date-end');
  const filterFournisseur = document.getElementById('filter-fournisseur');
  const btnReset = document.getElementById('btn-reset');
  
  // Vérifier que tous les éléments existent
  if (!filterSearch || !filterDateStart || !filterDateEnd || !filterFournisseur || !btnReset) {
    console.error('Certains éléments de filtre sont introuvables');
    return;
  }
  
  function applyFilters() {
    const search = filterSearch.value.toLowerCase().trim();
    const dateStart = filterDateStart.value ? new Date(filterDateStart.value) : null;
    const dateEnd = filterDateEnd.value ? new Date(filterDateEnd.value) : null;
    const fournisseurId = filterFournisseur.value;
    
    const rows = document.querySelectorAll('.data-row');
    let visibleCount = 0;
    let visibleTotal = 0;
    
    rows.forEach(row => {
      let visible = true;
      
      // Recherche textuelle
      if (search && !row.dataset.fournisseurNom.includes(search) && !row.dataset.reference.includes(search)) {
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
      
      // Fournisseur
      if (visible && fournisseurId && row.dataset.fournisseurId !== fournisseurId) {
        visible = false;
      }
      
      row.style.display = visible ? '' : 'none';
      if (visible) {
        visibleCount++;
        visibleTotal += parseFloat(row.dataset.montant || 0);
      }
    });
    
    document.getElementById('total-count').textContent = visibleCount;
    document.getElementById('total-amount').textContent = visibleTotal.toFixed(2) + ' €';
  }
  
  // Debounce pour la recherche
  let debounceTimer;
  filterSearch.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 300);
  });
  
  filterDateStart.addEventListener('change', applyFilters);
  filterDateEnd.addEventListener('change', applyFilters);
  filterFournisseur.addEventListener('change', applyFilters);
  
  btnReset.addEventListener('click', () => {
    filterSearch.value = '';
    filterDateStart.value = '';
    filterDateEnd.value = '';
    filterFournisseur.value = '';
    applyFilters();
  });
}

/**
 * Affiche les détails d'une réception
 */
async function viewReception(receptionId) {
  try {
    console.log('[viewReception] Chargement réception ID:', receptionId);
    const data = await window.api.invoke("receptions:get", receptionId);
    console.log('[viewReception] Données reçues:', data);
    
    if (!data || !data.header) {
      console.warn('[viewReception] Réception introuvable');
      window.showError?.("Réception introuvable");
      return;
    }
    
    const reception = data.header;
    const lignes = data.lignes || [];
    console.log('[viewReception] Affichage modal avec', lignes.length, 'lignes');

    // Créer un modal pour afficher les détails
    const modalHtml = `
      <div class="modal-overlay" id="receptionModal">
        <div class="modal-content" style="max-width: 800px;">
          <div class="modal-header">
            <h3>📥 Détails de la Réception</h3>
            <button class="modal-close" onclick="document.getElementById('receptionModal').remove()">×</button>
          </div>
          <div class="modal-body">
            <div class="reception-details">
              <div class="detail-row">
                <strong>Date:</strong> ${new Date(reception.date).toLocaleDateString('fr-FR')}
              </div>
              <div class="detail-row">
                <strong>Fournisseur:</strong> ${reception.fournisseur || 'Sans fournisseur'}
              </div>
              <div class="detail-row">
                <strong>Référence:</strong> ${reception.reference || '—'}
              </div>
            </div>
            
            ${lignes.length > 0 ? `
              <h4 style="margin-top: 20px;">Articles reçus:</h4>
              <table class="table" style="margin-top: 10px;">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Quantité</th>
                    <th>Unité</th>
                    <th>Prix unitaire</th>
                    <th style="text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${lignes.map(ligne => {
                    const qte = Number(ligne.quantite) || 0;
                    const prix = Number(ligne.prix_unitaire) || 0;
                    const total = qte * prix;
                    return `
                      <tr>
                        <td>${ligne.produit || '-'}</td>
                        <td>${qte}</td>
                        <td>${ligne.unite || '-'}</td>
                        <td style="text-align: right;">${prix > 0 ? prix.toFixed(2) + ' €' : '0.00 €'}</td>
                        <td style="text-align: right; font-weight: 600;">${total.toFixed(2)} €</td>
                      </tr>
                    `;
                  }).join('')}
                  <tr style="background: #e8f5e9; font-weight: bold;">
                    <td colspan="4" style="text-align: right;">TOTAL</td>
                    <td style="text-align: right;">${lignes.reduce((sum, l) => {
                      const qte = Number(l.quantite) || 0;
                      const prix = Number(l.prix_unitaire) || 0;
                      return sum + (qte * prix);
                    }, 0).toFixed(2)} €</td>
                  </tr>
                </tbody>
              </table>
            ` : '<p style="margin-top: 15px; color: #999;">Aucun article associé.</p>'}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('receptionModal').remove()">
              Fermer
            </button>
          </div>
        </div>
      </div>
      
      <style>
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
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    console.log('[viewReception] Modal inséré dans le DOM');
    
  } catch (error) {
    console.error("[viewReception] Erreur:", error);
    // Only show error if we actually failed (not if we returned early)
    if (error.message) {
      window.showError?.(`Erreur lors du chargement des détails: ${error.message}`);
    }
  }
}

/**
 * Ouvre la page réceptions pour éditer une réception
 */
async function editReception(receptionId) {
  // Retourner vers la page réceptions principale avec l'ID à éditer
  if (window.navigate) {
    // Stocker l'ID dans sessionStorage pour que la page réceptions le récupère
    sessionStorage.setItem('editReceptionId', receptionId);
    window.navigate('receptions');
  } else {
    window.showError?.("Fonction de navigation non disponible");
  }
}

// Exporter les fonctions
window.PageParamsHistoriqueReceptions = {
  render
};
