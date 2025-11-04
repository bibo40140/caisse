(() => {
  function showBusy(message = 'Veuillez patienter…') {
    let overlay = document.getElementById('busy-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'busy-overlay';
      overlay.innerHTML = `
        <div class="busy-backdrop"></div>
        <div class="busy-modal">
          <div class="busy-spinner"></div>
          <div class="busy-text"></div>
        </div>`;
      document.body.appendChild(overlay);

      const style = document.createElement('style');
      style.id = 'busy-style';
      style.textContent = `
        #busy-overlay { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
        .busy-backdrop { position:absolute; inset:0; background: rgba(0,0,0,.35); backdrop-filter: blur(2px); }
        .busy-modal { position:relative; background:#fff; border-radius:12px; padding:20px 28px; min-width: 280px; display:flex; gap:12px; align-items:center; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
        .busy-spinner { width: 26px; height: 26px; border: 3px solid #ddd; border-top-color: #4a89dc; border-radius: 50%; animation: spin .9s linear infinite; }
        .busy-text { font-size: 14px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }
    overlay.querySelector('.busy-text').textContent = message;
    overlay.style.display = 'grid';
  }
  function hideBusy() {
    const overlay = document.getElementById('busy-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  window.UIBusy = { showBusy, hideBusy };
})();