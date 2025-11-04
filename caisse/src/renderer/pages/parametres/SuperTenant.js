(() => {
  function renderSuperTenant() {
    const content = document.getElementById('page-content');
    if (!content) return;
    content.innerHTML = `<h2>Paramètres — Super tenant</h2><div id="tab-host"></div>`;
    const host = document.getElementById('tab-host');

    const box = document.createElement('div');
    host.appendChild(box);
    if (window.PageParams?.renderTenantsAdmin) {
      window.PageParams.renderTenantsAdmin();
    } else {
      host.innerHTML = `<p style="color:#6b7280;">Fonction renderTenantsAdmin introuvable.</p>`;
    }
  }

  window.PageParams = window.PageParams || {};
  window.PageParams.renderSuperTenant = renderSuperTenant;
})();