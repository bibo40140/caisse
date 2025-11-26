// src/renderer/pages/parametres/Synchronisation.js
(() => {
  // ——————————————————————————————————————————————
  //  Style minimal pour l’onglet de synchronisation
  //  (on NE touche PAS à .btn globale de l’app)
  // ——————————————————————————————————————————————
  if (!document.getElementById('sync-tabs-style')) {
    const st = document.createElement('style');
    st.id = 'sync-tabs-style';
    st.textContent = `
      .sync-tabs {
        display:flex;
        gap:8px;
        border-bottom:1px solid #eee;
        margin:10px 0 14px;
        flex-wrap:wrap;
      }
      .sync-tab {
        padding:8px 12px;
        border-radius:8px 8px 0 0;
        cursor:pointer;
      }
      .sync-tab.active {
        background:#f3f4f6;
        font-weight:600;
      }
      .sync-card {
        background:#fff;
        border:1px solid #e5e7eb;
        border-radius:12px;
        padding:14px;
        box-shadow:0 4px 14px rgba(0,0,0,.05);
        max-width:780px;
      }
      .muted {
        color:#6b7280;
        font-size:12px;
      }
      .sync-status {
        border:1px solid #eee;
        padding:12px;
        border-radius:8px;
        margin:10px 0;
      }
      .sync-actions {
        display:flex;
        gap:10px;
        margin-top:8px;
        flex-wrap:wrap;
      }
    `;
    document.head.appendChild(st);
  }

  // ——————————————————————————————————————————————
  //  Panneau d’état (file d’attente d’ops)
  // ——————————————————————————————————————————————
  async function showSyncPanel(hostId = 'parametres-souspage') {
    try {
      const s = await window.electronAPI.opsPendingCount?.();
      const pending = (s && typeof s.count === 'number') ? s.count : (s?.queue ?? 0);

      const old = document.getElementById('__sync-panel');
      if (old) old.remove();

      const wrap = document.getElementById(hostId) || document.body;
      const box = document.createElement('div');
      box.id = '__sync-panel';
      box.className = 'sync-status';
      
      const statusColor = pending === 0 ? '#10b981' : pending < 10 ? '#f59e0b' : '#ef4444';
      const statusIcon = pending === 0 ? '✓' : pending < 10 ? '⚠' : '✗';
      
      box.innerHTML = `
        <h3>🛰️ File d'attente de synchronisation</h3>
        <div style="display:flex; align-items:center; gap:12px; margin:12px 0;">
          <div style="font-size:48px; color:${statusColor};">${statusIcon}</div>
          <div>
            <div style="font-size:32px; font-weight:bold; color:${statusColor};">${pending}</div>
            <div class="muted">opération(s) en attente</div>
          </div>
        </div>
        <div class="sync-actions">
          <button id="sync-now" class="btn" ${pending === 0 ? 'disabled' : ''}>
            🔄 Pousser maintenant
          </button>
          <button id="sync-retry" class="btn" ${pending === 0 ? 'disabled' : ''}>
            ⤴️ Réessayer les ops en erreur
          </button>
          <button id="sync-refresh" class="btn">
            🔄 Rafraîchir
          </button>
        </div>
        <details style="margin-top:12px;">
          <summary style="cursor:pointer; padding:8px; background:#f3f4f6; border-radius:6px;">
            🔍 Détails techniques
          </summary>
          <pre id="sync-debug-pre" style="margin-top:8px; max-height:300px; overflow:auto; font-size:11px; background:#f9fafb; padding:8px; border-radius:6px; border:1px solid #e5e7eb;"></pre>
        </details>
      `;
      wrap.appendChild(box);

      // Afficher les détails dans le pre
      const pre = box.querySelector('#sync-debug-pre');
      if (pre) {
        pre.textContent = JSON.stringify(s, null, 2);
      }

      box.querySelector('#sync-now').onclick = async () => {
        if (pending === 0) return;
        try {
          const r = await window.electronAPI.opsPushNow();
          if (!r || r.ok === false) {
            window.showError?.(new Error(r?.error || 'Échec du push'), 'synchronisation') || 
              alert('Échec du push des opérations : ' + (r?.error || 'inconnu'));
          } else {
            const msg = `${r.sent ?? 0} opération(s) envoyée(s). ${r.pending ?? 0} restante(s).`;
            window.showSuccess?.(msg) || alert(msg);
          }
        } catch (e) {
          window.showError?.(e, 'push des opérations') || 
            alert('Erreur lors du push des opérations : ' + (e?.message || e));
        }
        // Rafraîchir le panneau
        setTimeout(() => showSyncPanel(hostId), 500);
      };
      
      box.querySelector('#sync-retry').onclick = async () => {
        if (pending === 0) return;
        if (!confirm(`Réinitialiser le compteur d'erreurs pour ${pending} opération(s) et réessayer ?`)) return;
        try {
          const res = await window.electronAPI.retryFailedOps();
          if (!res || res.ok === false) {
            window.showError?.(new Error(res?.error || 'Échec du ré-essai'), 'réessai') ||
              alert('Échec du ré-essai : ' + (res?.error || 'inconnu'));
          } else {
            const msg = `${res.reset || 0} op(s) réinitialisée(s). ${res.push?.sent ?? 0} envoyée(s).`;
            window.showSuccess?.(msg) || alert(msg);
          }
        } catch (e) {
          window.showError?.(e, 'ré-essai') || alert('Erreur lors du ré-essai : ' + (e?.message || e));
        }
        setTimeout(() => showSyncPanel(hostId), 500);
      };
      
      box.querySelector('#sync-refresh').onclick = () => {
        showSyncPanel(hostId);
      };
    } catch (e) {
      console.error('[Synchronisation] showSyncPanel error:', e);
    }
  }

  // ——————————————————————————————————————————————
  //  Chargement des logs
  // ——————————————————————————————————————————————
  async function loadLogs() {
    const container = document.getElementById('logs-container');
    const levelFilter = document.getElementById('log-level-filter');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding:20px;">Chargement...</div>';

    try {
      const level = levelFilter?.value || '';
      const res = await window.electronAPI.getRecentLogs({ 
        limit: 200, 
        filters: level ? { level } : {} 
      });
      
      if (!res?.ok || !res.logs) {
        throw new Error(res?.error || 'Pas de logs');
      }

      if (res.logs.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#6b7280;">Aucun log disponible</div>';
        return;
      }

      const html = res.logs.map(log => {
        const levelColor = {
          ERROR: '#ef4444',
          WARN: '#f59e0b',
          INFO: '#3b82f6',
          DEBUG: '#6b7280'
        }[log.level] || '#000';

        const time = new Date(log.timestamp).toLocaleString('fr-FR');
        const data = log.data ? `\n    ${log.data}` : '';
        
        return `<div style="margin-bottom:8px; padding:8px; background:#fff; border-left:3px solid ${levelColor}; border-radius:4px;">
          <div style="font-weight:bold; color:${levelColor};">[${log.level}] ${log.category}</div>
          <div style="color:#6b7280; font-size:10px;">${time}</div>
          <div style="margin-top:4px;">${log.message}${data}</div>
        </div>`;
      }).join('');

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div style="text-align:center; padding:20px; color:#ef4444;">Erreur: ${e?.message || e}</div>`;
    }
  }

  // ——————————————————————————————————————————————
  //  État de santé système
  // ——————————————————————————————————————————————
  async function getSystemHealth() {
    try {
      // Récupérer le nombre d'opérations en attente
      const pendingOps = await window.electronAPI?.countPendingOps?.() || 0;
      
      // Récupérer les logs récents pour détecter des erreurs
      const recentLogs = await window.electronAPI?.getRecentLogs?.(100) || [];
      const recentErrors = recentLogs.filter(log => log.level === 'ERROR');
      const recentWarnings = recentLogs.filter(log => log.level === 'WARN');
      
      // Déterminer l'état de connexion
      const lastSyncLog = recentLogs.find(log => log.context === 'sync');
      const lastErrorLog = recentErrors[0];
      
      let connectionStatus = 'online';
      let connectionMessage = 'Connecté au serveur';
      
      if (lastErrorLog && lastErrorLog.message.includes('réseau')) {
        connectionStatus = 'offline';
        connectionMessage = 'Serveur inaccessible';
      } else if (lastErrorLog && lastErrorLog.message.includes('timeout')) {
        connectionStatus = 'slow';
        connectionMessage = 'Connexion lente';
      } else if (pendingOps > 50) {
        connectionStatus = 'warning';
        connectionMessage = 'Nombreuses opérations en attente';
      }
      
      return {
        connection: {
          status: connectionStatus,
          message: connectionMessage
        },
        queue: {
          pending: pendingOps,
          status: pendingOps === 0 ? 'ok' : pendingOps < 10 ? 'warning' : 'error'
        },
        errors: {
          count: recentErrors.length,
          lastError: lastErrorLog ? lastErrorLog.message : null,
          status: recentErrors.length === 0 ? 'ok' : recentErrors.length < 5 ? 'warning' : 'error'
        },
        warnings: {
          count: recentWarnings.length,
          status: recentWarnings.length === 0 ? 'ok' : 'warning'
        }
      };
    } catch (e) {
      console.error('Erreur getSystemHealth:', e);
      return {
        connection: { status: 'unknown', message: 'Impossible de vérifier' },
        queue: { pending: 0, status: 'unknown' },
        errors: { count: 0, lastError: null, status: 'unknown' },
        warnings: { count: 0, status: 'unknown' }
      };
    }
  }

  async function renderHealthPanel(container) {
    const health = await getSystemHealth();
    
    const connectionIcon = {
      'online': '🟢',
      'offline': '🔴',
      'slow': '🟡',
      'warning': '🟠',
      'unknown': '⚪'
    }[health.connection.status] || '⚪';
    
    const queueIcon = health.queue.status === 'ok' ? '✅' : 
                      health.queue.status === 'warning' ? '⚠️' : '❌';
    
    const errorsIcon = health.errors.status === 'ok' ? '✅' : 
                       health.errors.status === 'warning' ? '⚠️' : '❌';
    
    container.innerHTML = `
      <div class="health-panel">
        <div class="health-item ${health.connection.status}">
          <div class="health-icon">${connectionIcon}</div>
          <div class="health-details">
            <div class="health-label">Connexion</div>
            <div class="health-value">${health.connection.message}</div>
          </div>
        </div>
        
        <div class="health-item ${health.queue.status}">
          <div class="health-icon">${queueIcon}</div>
          <div class="health-details">
            <div class="health-label">File d'attente</div>
            <div class="health-value">${health.queue.pending} opération(s) en attente</div>
          </div>
        </div>
        
        <div class="health-item ${health.errors.status}">
          <div class="health-icon">${errorsIcon}</div>
          <div class="health-details">
            <div class="health-label">Erreurs récentes</div>
            <div class="health-value">${health.errors.count} erreur(s) détectée(s)</div>
            ${health.errors.lastError ? `<div class="health-subtitle">${health.errors.lastError}</div>` : ''}
          </div>
        </div>
        
        <div class="health-item ${health.warnings.status}">
          <div class="health-icon">${health.warnings.count === 0 ? '✅' : '⚠️'}</div>
          <div class="health-details">
            <div class="health-label">Avertissements</div>
            <div class="health-value">${health.warnings.count} avertissement(s)</div>
          </div>
        </div>
      </div>
    `;
  }

  // ——————————————————————————————————————————————
  //  Actions PUSH / PULL (boutons)
  // ——————————————————————————————————————————————
  async function doPush() {
    if (!confirm("Envoyer TOUTE la base locale vers Neon (création/mise à jour complète) ?")) return;
    try {
      window.__syncBadgeSet?.('Envoi complet…', '#b45309');
      const r = await (window.electronAPI?.syncPushBootstrapRefs?.() ?? window.electronAPI?.syncPushAll?.());
      if (r?.ok) {
        window.__syncBadgeSet?.('Synchronisé (push complet)', '#065f46');
        window.showSuccess?.('Push complet terminé.') || alert('✅ Push complet terminé.');
        try {
          window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
          const pullRes = await window.electronAPI?.syncPullAll?.();
          if (pullRes?.ok) window.__syncBadgeSet?.('Données à jour', '#065f46');
        } catch {}
      } else {
        window.__syncBadgeSet?.('Échec envoi complet', '#9f1239');
        window.showError?.(new Error(r?.error || 'Push échoué'), 'push') || alert("Push complet KO : " + (r?.error || 'inconnu'));
      }
    } catch (e) {
      window.__syncBadgeSet?.('Échec envoi complet', '#9f1239');
      window.showError?.(e, 'push') || alert("Push complet KO : " + (e?.message || e));
    }
  }

  async function doPull() {
    if (!confirm("Remplacer/mettre à jour la base LOCALE depuis Neon (pull complet) ?")) return;
    try {
      window.__syncBadgeSet?.('Rafraîchissement…', '#b45309');
      const r = await window.electronAPI?.syncPullAll?.();
      if (r?.ok) {
        window.__syncBadgeSet?.('Synchronisé (pull)', '#065f46');
        window.showSuccess?.('Pull terminé.') || alert('✅ Pull terminé.');
      } else {
        window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
        window.showError?.(new Error(r?.error || 'Pull échoué'), 'pull') || alert("Pull KO : " + (r?.error || 'inconnu'));
      }
    } catch (e) {
      window.__syncBadgeSet?.('Échec rafraîchissement', '#9f1239');
      window.showError?.(e, 'pull') || alert("Pull KO : " + (e?.message || e));
    }
  }

  // ——————————————————————————————————————————————
  //  Rendu de la page Paramètres > Synchronisation
  // ——————————————————————————————————————————————
  async function render() {
    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = `
      <h2>Synchronisation</h2>

      <div class="sync-tabs">
        <div class="sync-tab active" data-tab="status">📊 État</div>
        <div class="sync-tab" data-tab="push">⬆️ Push</div>
        <div class="sync-tab" data-tab="pull">⬇️ Pull</div>
        <div class="sync-tab" data-tab="logs">📝 Logs</div>
        <div class="sync-tab" data-tab="diagnostic">🔍 Diagnostic</div>
      </div>

      <div id="parametres-souspage"><!-- contenu tab injecté ici --></div>
   `;

    async function switchTab(key) {
      content.querySelectorAll('.sync-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
      const host = document.getElementById('parametres-souspage');

      if (key === 'status') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>📊 État de la synchronisation</h3>
            <p class="muted">
              Visualisez l'état du système et des opérations en attente.
            </p>
          </div>
          <div class="sync-card">
            <h3>🏥 Santé du système</h3>
            <div id="health-panel-container">Chargement...</div>
          </div>
          <div class="sync-card">
            <h3>📋 Opérations en attente</h3>
            <div id="sync-panel-container"></div>
          </div>
        `;
        // Afficher le panneau de santé
        const healthContainer = host.querySelector('#health-panel-container');
        if (healthContainer) {
          await renderHealthPanel(healthContainer);
          // Rafraîchir toutes les 5 secondes
          setInterval(async () => {
            if (document.querySelector('#health-panel-container')) {
              await renderHealthPanel(healthContainer);
            }
          }, 5000);
        }
        // Afficher le panneau d'état des opérations
        showSyncPanel('sync-panel-container');
      } else if (key === 'push') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Push (local → Neon)</h3>
            <p class="muted">
              Envoie la base locale (référentiels / produits…) vers Neon.
              À utiliser pour un gros rattrapage ou une première mise en ligne.
            </p>
            <div class="sync-actions">
              <button id="btn-sync-push" class="btn">Lancer le Push complet</button>
            </div>
          </div>
        `;
        host.querySelector('#btn-sync-push')?.addEventListener('click', doPush);
      } else if (key === 'pull') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>Pull (Neon → local)</h3>
            <p class="muted">
              Remplace / met à jour la base locale depuis Neon.
            </p>
            <div class="sync-actions">
              <button id="btn-sync-pull" class="btn">Lancer le Pull complet</button>
            </div>
          </div>
        `;
        host.querySelector('#btn-sync-pull')?.addEventListener('click', doPull);
      } else if (key === 'logs') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>📝 Journaux de synchronisation</h3>
            <p class="muted">
              Consultez les logs détaillés des opérations de synchronisation.
            </p>
            <div class="sync-actions">
              <button id="btn-logs-refresh" class="btn">🔄 Rafraîchir</button>
              <button id="btn-logs-export" class="btn">💾 Exporter</button>
              <button id="btn-logs-clear" class="btn">🗑️ Vider les logs</button>
            </div>
            <div style="margin-top:16px;">
              <label>
                Niveau:
                <select id="log-level-filter" style="margin-left:8px; padding:4px;">
                  <option value="">Tous</option>
                  <option value="ERROR">Erreurs</option>
                  <option value="WARN">Avertissements</option>
                  <option value="INFO">Informations</option>
                  <option value="DEBUG">Debug</option>
                </select>
              </label>
            </div>
            <div id="logs-container" style="margin-top:16px; max-height:400px; overflow-y:auto; background:#f9fafb; padding:12px; border-radius:8px; border:1px solid #e5e7eb; font-family:monospace; font-size:11px;">
              Chargement...
            </div>
          </div>
        `;
        
        await loadLogs();
        
        host.querySelector('#btn-logs-refresh')?.addEventListener('click', loadLogs);
        host.querySelector('#log-level-filter')?.addEventListener('change', loadLogs);
        host.querySelector('#btn-logs-export')?.addEventListener('click', async () => {
          try {
            const res = await window.electronAPI.exportLogs();
            if (res?.ok) {
              window.showSuccess?.(`Logs exportés vers: ${res.filePath}`) || alert(`Logs exportés vers: ${res.filePath}`);
            } else {
              throw new Error(res?.error || 'Échec export');
            }
          } catch (e) {
            window.showError?.(e, 'export des logs') || alert('Erreur export: ' + (e?.message || e));
          }
        });
        host.querySelector('#btn-logs-clear')?.addEventListener('click', async () => {
          if (!confirm('Vider tous les logs ?')) return;
          try {
            const res = await window.electronAPI.clearLogs();
            if (res?.ok) {
              window.showSuccess?.('Logs vidés') || console.log('Logs vidés');
              loadLogs();
            } else {
              throw new Error(res?.error || 'Échec');
            }
          } catch (e) {
            window.showError?.(e, 'suppression des logs') || alert('Erreur: ' + (e?.message || e));
          }
        });
      } else if (key === 'diagnostic') {
        host.innerHTML = `
          <div class="sync-card">
            <h3>🔍 Diagnostic complet</h3>
            <p class="muted">
              Exportez un rapport de diagnostic complet incluant les logs, l'état de la queue, 
              la configuration système et les statistiques de la base de données.
            </p>
            <div class="sync-actions">
              <button id="btn-export-diagnostic" class="btn">📊 Exporter le diagnostic</button>
            </div>
            <div style="margin-top:24px; padding:16px; background:#f0f9ff; border-radius:8px; border-left:4px solid #3b82f6;">
              <strong>ℹ️ Contenu du diagnostic :</strong>
              <ul style="margin:8px 0 0 20px; line-height:1.8;">
                <li>📝 Logs récents (100 dernières entrées)</li>
                <li>📊 État de la file d'attente (opérations en attente/échouées)</li>
                <li>⚙️ Configuration système (version, plateforme, device ID)</li>
                <li>💾 Statistiques base de données (produits, ventes, adhérents, mouvements)</li>
                <li>🔍 Informations d'environnement (API URL, tenant ID)</li>
              </ul>
              <p style="margin-top:12px; font-size:13px; color:#6b7280;">
                Ce fichier JSON peut être partagé avec le support technique pour faciliter le diagnostic des problèmes.
              </p>
            </div>
          </div>
        `;
        
        host.querySelector('#btn-export-diagnostic')?.addEventListener('click', async () => {
          try {
            const res = await window.electronAPI.exportDiagnostic();
            if (res?.ok) {
              window.showSuccess?.(`Diagnostic exporté vers: ${res.filePath}`) || alert(`✅ Diagnostic exporté vers:\n${res.filePath}`);
            } else {
              throw new Error(res?.error || 'Échec export diagnostic');
            }
          } catch (e) {
            window.showError?.(e, 'export du diagnostic') || alert('Erreur export diagnostic: ' + (e?.message || e));
          }
        });
      }

      // Le panneau d'état est affiché seulement dans l'onglet "status"
      if (key !== 'status') {
        // Retirer l'ancien panneau s'il existe
        const old = document.getElementById('__sync-panel');
        if (old) old.remove();
      }
    }

    content.querySelectorAll('.sync-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // onglet par défaut : État
    switchTab('status');
  }

  window.PageParamsSync = { render };
})();
