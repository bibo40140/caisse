// src/renderer/pages/parametres/Statistiques.js
(() => {
  async function render() {
    const content = document.getElementById('parametres-souspage');
    if (!content) return;

    // Injecter les styles
    if (!document.getElementById('stats-styles')) {
      const st = document.createElement('style');
      st.id = 'stats-styles';
      st.textContent = `
        .stats-container { max-width: 1200px; }
        .stats-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
        .stats-period { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .stats-period select { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.1); }
        .stat-card.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
        .stat-card.blue { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
        .stat-card.orange { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
        .stat-card.purple { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .stat-label { font-size: 13px; opacity: 0.9; margin-bottom: 8px; }
        .stat-value { font-size: 32px; font-weight: 700; }
        .stat-trend { font-size: 12px; margin-top: 8px; opacity: 0.85; }
        .chart-section { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .chart-section h3 { margin-top: 0; color: #1f2937; }
        .chart-container { height: 300px; position: relative; }
        canvas { max-height: 100%; }
        .top-products { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
        .top-products table { width: 100%; border-collapse: collapse; }
        .top-products th { text-align: left; padding: 10px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 13px; }
        .top-products td { padding: 10px; border-bottom: 1px solid #f3f4f6; }
        .product-name { font-weight: 600; color: #1f2937; }
        .product-qty { color: #6b7280; font-size: 14px; }
        .product-revenue { color: #10b981; font-weight: 600; }
      `;
      document.head.appendChild(st);
    }

    content.innerHTML = `
      <div class="stats-container">
        <div class="stats-header">
          <h2>📊 Statistiques</h2>
          <div class="stats-period">
            <label>Mode :</label>
            <select id="stats-mode">
              <option value="quick" selected>Rapide</option>
              <option value="month">Mois</option>
              <option value="year">Année</option>
            </select>
            
            <div id="filter-quick" style="display:flex;gap:10px;align-items:center;">
              <label>Période :</label>
              <select id="stats-period">
                <option value="7">7 derniers jours</option>
                <option value="30" selected>30 derniers jours</option>
                <option value="90">90 derniers jours</option>
                <option value="365">Année</option>
                <option value="all">Tout</option>
              </select>
            </div>
            
            <div id="filter-month" style="display:none;gap:10px;align-items:center;">
              <label>Mois :</label>
              <select id="stats-month"></select>
              <select id="stats-month-year"></select>
            </div>
            
            <div id="filter-year" style="display:none;gap:10px;align-items:center;">
              <label>Année :</label>
              <select id="stats-year"></select>
            </div>
          </div>
        </div>

        <div class="stats-grid" id="stats-summary"></div>

        <div class="chart-section">
          <h3>📈 Évolution du chiffre d'affaires</h3>
          <div class="chart-container">
            <canvas id="chart-revenue"></canvas>
          </div>
        </div>

        <div class="chart-section">
          <h3>📦 Réceptions vs Ventes (quantités)</h3>
          <div class="chart-container">
            <canvas id="chart-quantities"></canvas>
          </div>
        </div>

        <div class="top-products">
          <h3>🏆 Top 10 produits vendus</h3>
          <table id="top-products-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Produit</th>
                <th>Quantité</th>
                <th>CA</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="chart-section" style="margin-top: 30px;">
          <h3>📧 Rapports automatiques par email</h3>
          <p style="color: #6b7280; font-size: 14px; margin-bottom: 15px;">
            Les rapports sont envoyés automatiquement :<br>
            • <strong>Hebdomadaire</strong> : Chaque dimanche à 12h00<br>
            • <strong>Mensuel</strong> : Le 1er dimanche de chaque mois à 12h00
          </p>
          <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button id="test-weekly-report" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
              📨 Tester rapport hebdomadaire
            </button>
            <button id="test-monthly-report" style="padding: 10px 20px; background: #8b5cf6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
              📨 Tester rapport mensuel
            </button>
          </div>
          <div id="report-status" style="margin-top: 10px; padding: 10px; border-radius: 6px; display: none;"></div>
        </div>
      </div>
    `;

    // Charger Chart.js si pas déjà chargé
    await loadChartJS();

    // Initialiser les sélecteurs de mois/année
    initializeDateSelectors();

    // Charger les données et afficher
    await loadStatsByMode();

    // Bind mode
    document.getElementById('stats-mode')?.addEventListener('change', (e) => {
      const mode = e.target.value;
      document.getElementById('filter-quick').style.display = mode === 'quick' ? 'flex' : 'none';
      document.getElementById('filter-month').style.display = mode === 'month' ? 'flex' : 'none';
      document.getElementById('filter-year').style.display = mode === 'year' ? 'flex' : 'none';
      loadStatsByMode();
    });

    // Bind période rapide
    document.getElementById('stats-period')?.addEventListener('change', () => loadStatsByMode());

    // Bind mois
    document.getElementById('stats-month')?.addEventListener('change', () => loadStatsByMode());
    document.getElementById('stats-month-year')?.addEventListener('change', () => loadStatsByMode());

    // Bind année
    document.getElementById('stats-year')?.addEventListener('change', () => loadStatsByMode());

    // Bind boutons de test des rapports
    document.getElementById('test-weekly-report')?.addEventListener('click', async () => {
      const btn = document.getElementById('test-weekly-report');
      const status = document.getElementById('report-status');
      
      console.log('[Statistiques] 📧 Clic sur bouton test rapport hebdomadaire');
      
      btn.disabled = true;
      btn.textContent = '⏳ Envoi en cours...';
      status.style.display = 'none';
      
      try {
        console.log('[Statistiques] Appel window.electronAPI.sendWeeklyReport...');
        console.log('[Statistiques] electronAPI existe?', !!window.electronAPI);
        console.log('[Statistiques] sendWeeklyReport existe?', !!window.electronAPI?.sendWeeklyReport);
        
        const success = await window.electronAPI?.sendWeeklyReport?.();
        
        console.log('[Statistiques] Résultat sendWeeklyReport:', success);
        console.log('[Statistiques] Type:', typeof success);
        
        status.style.display = 'block';
        if (success) {
          console.log('[Statistiques] ✅ Succès!');
          status.style.background = '#d1fae5';
          status.style.color = '#065f46';
          status.textContent = '✅ Rapport hebdomadaire envoyé avec succès !';
        } else {
          console.log('[Statistiques] ❌ Échec (success = false)');
          status.style.background = '#fee2e2';
          status.style.color = '#991b1b';
          status.textContent = '❌ Erreur lors de l\'envoi. Vérifiez la configuration email dans les paramètres.';
        }
      } catch (e) {
        console.error('[Statistiques] ❌ Exception:', e);
        console.error('[Statistiques] Stack:', e.stack);
        status.style.display = 'block';
        status.style.background = '#fee2e2';
        status.style.color = '#991b1b';
        status.textContent = '❌ Erreur : ' + (e.message || e);
      } finally {
        btn.disabled = false;
        btn.textContent = '📨 Tester rapport hebdomadaire';
      }
    });

    document.getElementById('test-monthly-report')?.addEventListener('click', async () => {
      const btn = document.getElementById('test-monthly-report');
      const status = document.getElementById('report-status');
      
      console.log('[Statistiques] 📧 Clic sur bouton test rapport mensuel');
      
      btn.disabled = true;
      btn.textContent = '⏳ Envoi en cours...';
      status.style.display = 'none';
      
      try {
        console.log('[Statistiques] Appel window.electronAPI.sendMonthlyReport...');
        const success = await window.electronAPI?.sendMonthlyReport?.();
        console.log('[Statistiques] Résultat sendMonthlyReport:', success);
        
        status.style.display = 'block';
        if (success) {
          console.log('[Statistiques] ✅ Succès!');
          status.style.background = '#d1fae5';
          status.style.color = '#065f46';
          status.textContent = '✅ Rapport mensuel envoyé avec succès !';
        } else {
          console.log('[Statistiques] ❌ Échec (success = false)');
          status.style.background = '#fee2e2';
          status.style.color = '#991b1b';
          status.textContent = '❌ Erreur lors de l\'envoi. Vérifiez la configuration email dans les paramètres.';
        }
      } catch (e) {
        console.error('[Statistiques] ❌ Exception:', e);
        status.style.display = 'block';
        status.style.background = '#fee2e2';
        status.style.color = '#991b1b';
        status.textContent = '❌ Erreur : ' + (e.message || e);
      } finally {
        btn.disabled = false;
        btn.textContent = '📨 Tester rapport mensuel';
      }
    });
  }

  function initializeDateSelectors() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Remplir le sélecteur de mois
    const monthSelect = document.getElementById('stats-month');
    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    months.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = m;
      if (i === currentMonth) opt.selected = true;
      monthSelect.appendChild(opt);
    });

    // Remplir le sélecteur d'année pour les mois (5 dernières années)
    const monthYearSelect = document.getElementById('stats-month-year');
    for (let y = currentYear; y >= currentYear - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === currentYear) opt.selected = true;
      monthYearSelect.appendChild(opt);
    }

    // Remplir le sélecteur d'année (5 dernières années)
    const yearSelect = document.getElementById('stats-year');
    for (let y = currentYear; y >= currentYear - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === currentYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
  }

  async function loadStatsByMode() {
    const mode = document.getElementById('stats-mode')?.value || 'quick';
    
    let dateFrom, dateTo;
    
    if (mode === 'quick') {
      const days = document.getElementById('stats-period')?.value || '30';
      const daysNum = days === 'all' ? 9999 : parseInt(days);
      await loadStats(daysNum);
      return;
    } else if (mode === 'month') {
      const month = parseInt(document.getElementById('stats-month')?.value || '0');
      const year = parseInt(document.getElementById('stats-month-year')?.value || new Date().getFullYear());
      
      // Premier jour du mois
      dateFrom = new Date(year, month, 1);
      // Dernier jour du mois
      dateTo = new Date(year, month + 1, 0);
    } else if (mode === 'year') {
      const year = parseInt(document.getElementById('stats-year')?.value || new Date().getFullYear());
      
      // 1er janvier
      dateFrom = new Date(year, 0, 1);
      // 31 décembre
      dateTo = new Date(year, 11, 31);
    }

    if (dateFrom && dateTo) {
      await loadStatsByDateRange(dateFrom, dateTo);
    }
  }

  async function loadChartJS() {
    if (window.Chart) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadStats(days) {
    try {
      // Récupérer les données
      const [ventes, receptions, produits] = await Promise.all([
        window.electronAPI?.getVentesStats?.(days) || { total: 0, count: 0, byDay: [], byProduct: [] },
        window.electronAPI?.getReceptionsStats?.(days) || { total: 0, count: 0, byDay: [] },
        window.electronAPI?.getProduitsCount?.() || 0
      ]);

      // Afficher les cartes de résumé
      displaySummary(ventes, receptions, produits);

      // Afficher les graphiques
      displayRevenueChart(ventes.byDay || []);
      displayQuantitiesChart(ventes.byDay || [], receptions.byDay || []);

      // Afficher le top produits
      displayTopProducts(ventes.byProduct || []);

    } catch (e) {
      console.error('[Stats] Erreur chargement:', e);
      const content = document.getElementById('parametres-souspage');
      if (content) content.innerHTML = `<p style="color:red;">Erreur: ${e?.message || e}</p>`;
    }
  }

  async function loadStatsByDateRange(dateFrom, dateTo) {
    try {
      const from = dateFrom.toISOString().split('T')[0];
      const to = dateTo.toISOString().split('T')[0];

      // Récupérer les données avec plage de dates
      const [ventes, receptions, produits] = await Promise.all([
        window.electronAPI?.getVentesStatsByRange?.(from, to) || { total: 0, count: 0, byDay: [], byProduct: [] },
        window.electronAPI?.getReceptionsStatsByRange?.(from, to) || { total: 0, count: 0, byDay: [] },
        window.electronAPI?.getProduitsCount?.() || 0
      ]);

      // Afficher les cartes de résumé
      displaySummary(ventes, receptions, produits);

      // Afficher les graphiques
      displayRevenueChart(ventes.byDay || []);
      displayQuantitiesChart(ventes.byDay || [], receptions.byDay || []);

      // Afficher le top produits
      displayTopProducts(ventes.byProduct || []);

    } catch (e) {
      console.error('[Stats] Erreur chargement par plage:', e);
      const content = document.getElementById('parametres-souspage');
      if (content) content.innerHTML = `<p style="color:red;">Erreur: ${e?.message || e}</p>`;
    }
  }

  function displaySummary(ventes, receptions, produitsCount) {
    const summary = document.getElementById('stats-summary');
    if (!summary) return;

    summary.innerHTML = `
      <div class="stat-card green">
        <div class="stat-label">Chiffre d'affaires</div>
        <div class="stat-value">${(ventes.total || 0).toFixed(2)} €</div>
        <div class="stat-trend">${ventes.count || 0} ventes</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">Réceptions</div>
        <div class="stat-value">${(receptions.total || 0).toFixed(2)} €</div>
        <div class="stat-trend">${receptions.count || 0} réceptions</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">Produits référencés</div>
        <div class="stat-value">${produitsCount || 0}</div>
        <div class="stat-trend">Total catalogue</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">Panier moyen</div>
        <div class="stat-value">${ventes.count > 0 ? (ventes.total / ventes.count).toFixed(2) : '0.00'} €</div>
        <div class="stat-trend">Par vente</div>
      </div>
    `;
  }

  let revenueChart = null;
  function displayRevenueChart(byDay) {
    const canvas = document.getElementById('chart-revenue');
    if (!canvas) return;

    if (revenueChart) {
      revenueChart.destroy();
      revenueChart = null;
    }

    const ctx = canvas.getContext('2d');
    const labels = byDay.map(d => d.date);
    const data = byDay.map(d => d.total);

    revenueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'CA (€)',
          data,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => value + ' €'
            }
          }
        }
      }
    });
  }

  let quantitiesChart = null;
  function displayQuantitiesChart(ventesByDay, receptionsByDay) {
    const canvas = document.getElementById('chart-quantities');
    if (!canvas) return;

    if (quantitiesChart) {
      quantitiesChart.destroy();
      quantitiesChart = null;
    }

    const ctx = canvas.getContext('2d');

    const allDates = [...new Set([
      ...ventesByDay.map(d => d.date),
      ...receptionsByDay.map(d => d.date)
    ])].sort();

    const ventesQty = allDates.map(date => {
      const found = ventesByDay.find(d => d.date === date);
      return found ? found.quantity : 0;
    });

    const receptionsQty = allDates.map(date => {
      const found = receptionsByDay.find(d => d.date === date);
      return found ? found.quantity : 0;
    });

    quantitiesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: allDates,
        datasets: [
          {
            label: 'Ventes',
            data: ventesQty,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderColor: '#ef4444',
            borderWidth: 1
          },
          {
            label: 'Réceptions',
            data: receptionsQty,
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: '#3b82f6',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  function displayTopProducts(byProduct) {
    const tbody = document.querySelector('#top-products-table tbody');
    if (!tbody) return;

    const sorted = (byProduct || [])
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    if (sorted.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9ca3af;">Aucune donnée</td></tr>';
      return;
    }

    tbody.innerHTML = sorted.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="product-name">${p.nom || 'Produit inconnu'}</td>
        <td class="product-qty">${p.quantity || 0} unités</td>
        <td class="product-revenue">${(p.revenue || 0).toFixed(2)} €</td>
      </tr>
    `).join('');
  }

  window.PageParamsStatistiques = { render };
})();
