(() => {
  function renderTabs(host, tabs) {
    if (!host) return;
    host.innerHTML = `
      <div class="p-tabs">
        <div class="p-tabs-bar"></div>
        <div class="p-tabs-body"></div>
      </div>
    `;
    if (!document.getElementById('p-tabs-style')) {
      const st = document.createElement('style');
      st.id = 'p-tabs-style';
      st.textContent = `
        .p-tabs-bar { display:flex; gap:8px; border-bottom:1px solid #eee; margin-bottom:10px; flex-wrap:wrap; }
        .p-tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
        .p-tab.active { background:#f3f4f6; font-weight:600; }
      `;
      document.head.appendChild(st);
    }
    const bar  = host.querySelector('.p-tabs-bar');
    const body = host.querySelector('.p-tabs-body');
    function show(id) {
      [...bar.children].forEach(b => b.classList.toggle('active', b.dataset.id === id));
      body.innerHTML = '<div style="padding:6px;color:#6b7280;">Chargement…</div>';
      const tab = tabs.find(t => t.id === id);
      if (tab?.onShow) tab.onShow(body);
    }
    tabs.forEach((t, i) => {
      const b = document.createElement('div');
      b.className = `p-tab ${i===0 ? 'active':''}`;
      b.dataset.id = t.id;
      b.textContent = t.label;
      b.onclick = () => show(t.id);
      bar.appendChild(b);
    });
    if (tabs[0]) show(tabs[0].id);
  }
  window.ParamTabs = { renderTabs };
})();