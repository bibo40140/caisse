// src/renderer/pages/helpers.js
(function () {
  // Cache simple pour la config modules (évite des invocations multiples)
  let _mods = null;
  window.getMods = async function getMods() {
    if (!_mods) _mods = await window.electronAPI.getModules();
    return _mods;
	
	
	
  };
  window.clearModsCache = function () { _mods = null; };
})();
// --- Helpers recherche (normalisation / tokens) ---
(function () {
  if (window.__searchHelpers__) return;
  window.__searchHelpers__ = true;
  window._norm = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  window._sing = (s) => s.replace(/s\b/g, '');
  window._tokens = (s) => _norm(s).split(/\s+/).map(_sing).filter(Boolean);
})();

// --- Loader global ---
(function ensureLoaderStyles(){
  if (document.getElementById('loader-style')) return;
  const s = document.createElement('style');
  s.id = 'loader-style';
  s.textContent = `
    #app-loader{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:saturate(120%) blur(2px);z-index:999999;}
    #app-loader .box{background:#fff;padding:16px 18px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);display:flex;align-items:center;gap:12px;font-weight:600}
    #app-loader .spinner{width:18px;height:18px;border:3px solid #ddd;border-top-color:#555;border-radius:50%;animation:spin 0.8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  `;
  document.head.appendChild(s);
})();
window.showLoader = (message='Traitement en cours…') => {
  let o = document.getElementById('app-loader');
  if (!o) {
    o = document.createElement('div');
    o.id = 'app-loader';
    o.innerHTML = `<div class="box"><div class="spinner"></div><div class="txt"></div></div>`;
    document.body.appendChild(o);
  }
  o.querySelector('.txt').textContent = message;
  o.style.display = 'flex';
};
window.hideLoader = () => {
  const o = document.getElementById('app-loader');
  if (o) o.style.display = 'none';
};

// --- Modals ---
window.showConfirmModal = (message) => new Promise((resolve) => {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <p>${message}</p>
      <div class="modal-actions">
        <button id="confirm-yes">Oui</button>
        <button id="confirm-no">Non</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const handleYes = () => { modal.remove(); resolve(true); };
  const handleNo = () => { modal.remove(); resolve(false); };
  const handleKeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleYes(); }
    if (e.key === 'Escape') { e.preventDefault(); handleNo(); }
  };
  
  document.getElementById('confirm-yes').onclick = handleYes;
  document.getElementById('confirm-no').onclick = handleNo;
  document.addEventListener('keydown', handleKeydown);
  modal._cleanup = () => document.removeEventListener('keydown', handleKeydown);
  modal._originalRemove = modal.remove;
  modal.remove = function() { if (this._cleanup) this._cleanup(); this._originalRemove.call(this); };
  document.getElementById('confirm-yes').focus();
});

window.showAlertModal = (message) => new Promise((resolve) => {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const displayedMessage = (typeof message === 'object')
    ? (message.message || JSON.stringify(message, null, 2))
    : String(message);
  modal.innerHTML = `
    <div class="modal">
      <p>${displayedMessage.replace(/\n/g, '<br>')}</p>
      <div class="modal-actions">
        <button id="alert-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const handleOk = () => { modal.remove(); resolve(); };
  const handleKeydown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); handleOk(); }
  };
  
  document.getElementById('alert-ok').onclick = handleOk;
  document.addEventListener('keydown', handleKeydown);
  modal._cleanup = () => document.removeEventListener('keydown', handleKeydown);
  modal._originalRemove = modal.remove;
  modal.remove = function() { if (this._cleanup) this._cleanup(); this._originalRemove.call(this); };
  document.getElementById('alert-ok').focus();
});

window.showFormModal = (titre, formElement) => new Promise((resolve) => {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h3>${titre}</h3>
      <div class="modal-body"></div>
      <div class="modal-actions">
        <button id="form-ok">✅ Valider</button>
        <button id="form-cancel">Annuler</button>
      </div>
    </div>
  `;
  modal.querySelector('.modal-body').appendChild(formElement);
  document.body.appendChild(modal);
  
  const handleOk = () => {
    const form = modal.querySelector('form') || formElement;
    if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    modal.remove();
    resolve(true);
  };
  const handleCancel = () => { modal.remove(); resolve(false); };
  const handleKeydown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) { e.preventDefault(); handleOk(); }
    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
  };
  
  document.getElementById('form-ok').onclick = handleOk;
  document.getElementById('form-cancel').onclick = handleCancel;
  document.addEventListener('keydown', handleKeydown);
  modal._cleanup = () => document.removeEventListener('keydown', handleKeydown);
  modal._originalRemove = modal.remove;
  modal.remove = function() { if (this._cleanup) this._cleanup(); this._originalRemove.call(this); };
  (formElement.querySelector('input') || document.getElementById('form-ok')).focus();
});

window.showPromptModal = (message, defaultValue = "5") => new Promise((resolve) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <p>${message.replace(/\n/g, "<br>")}</p>
      <input type="number" id="modal-prompt-input" min="5" step="1" inputmode="numeric" pattern="[0-9]*" value="${defaultValue}" style="margin: 10px 0; padding: 8px; width: 100%;">
      <div class="modal-actions">
        <button id="modal-prompt-ok">OK</button>
        <button id="modal-prompt-cancel">Annuler</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = document.getElementById("modal-prompt-input");
  
  const handleOk = () => { overlay.remove(); resolve(input.value); };
  const handleCancel = () => { overlay.remove(); resolve(null); };
  
  input.focus();
  input.addEventListener("keydown", (e) => { 
    if (e.key === "." || e.key === "," || e.key === "Decimal") e.preventDefault();
    if (e.key === "Enter") { e.preventDefault(); handleOk(); }
    if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
  });
  input.addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ""); });
  document.getElementById("modal-prompt-ok").addEventListener("click", handleOk);
  document.getElementById("modal-prompt-cancel").addEventListener("click", handleCancel);
});

// --- Choix multiple simple ---
window.showChoixModal = (message, options) => new Promise((resolve) => {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <p>${message}</p>
      <div class="modal-actions">
        ${options.map((opt, idx) => `<button data-choice="${idx}">${opt}</button>`).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const handleChoice = (choix) => { modal.remove(); resolve(choix); };
  const handleKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); modal.remove(); resolve(null); }
  };
  
  modal.querySelectorAll('button').forEach((btn, idx) => {
    btn.addEventListener('click', () => { handleChoice(options[idx]); });
  });
  document.addEventListener('keydown', handleKeydown);
  modal._cleanup = () => document.removeEventListener('keydown', handleKeydown);
  modal._originalRemove = modal.remove;
  modal.remove = function() { if (this._cleanup) this._cleanup(); this._originalRemove.call(this); };
  modal.querySelector('button').focus();
});

// --- Datalist “chevron” ---
window.wireDatalistChevron = (inputId) => {
  const input = document.getElementById(inputId);
  const chevron = input?.parentElement?.querySelector('.ui-chevron');
  if (!input || !chevron) return;
  const listId = input.getAttribute('list');
  const datalist = listId ? document.getElementById(listId) : null;
  if (!datalist) return;
  if (input.dataset.dropdownWired === '1') return;
  input.dataset.dropdownWired = '1';

  const allValues = [...datalist.querySelectorAll('option')].map(o => o.value);
  const menu = document.createElement('div');
  menu.className = 'dl-menu';
  document.body.appendChild(menu);

  function build(items) {
    menu.innerHTML = items.map(v => `<div class="dl-item" data-v="${v.replace(/"/g,'&quot;')}">${v}</div>`).join('');
    menu.querySelectorAll('.dl-item').forEach(it => {
      it.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const v = it.getAttribute('data-v') || '';
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        hide();
      });
    });
  }
  function position() {
    const r = input.getBoundingClientRect();
    menu.style.left = `${window.scrollX + r.left}px`;
    menu.style.top  = `${window.scrollY + r.bottom + 4}px`;
    menu.style.minWidth = `${r.width}px`;
  }
  function show(items = allValues) { build(items); position(); menu.style.display = 'block'; }
  function hide() { menu.style.display = 'none'; }

  chevron.addEventListener('mousedown', (e) => {
    e.preventDefault();
    input.value = ''; input.focus(); show(allValues);
  });
  input.addEventListener('input', () => {
    if (menu.style.display !== 'block') return;
    const q = (input.value || '').toLowerCase();
    const items = allValues.filter(v => v.toLowerCase().includes(q));
    build(items);
  });
  document.addEventListener('mousedown', (e) => {
    if (menu.style.display !== 'block') return;
    if (e.target === input || e.target === chevron || menu.contains(e.target)) return;
    hide();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (menu.style.display==='block') position(); }, true);
  window.addEventListener('resize', () => { if (menu.style.display==='block') position(); });
};

// === Catégories : options groupées par famille ===============================
(function () {
  function esc(s){ return (s??'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // cats = [{id, nom, famille_nom?}] – renvoie <optgroup>...<option>...
  function buildCategoryOptionsGrouped(cats, selectedId = null) {
    const enriched = (cats||[]).map(c => ({...c, famille_nom: c.famille_nom || 'Autres'}));
    const famMap = new Map();
    enriched.forEach(c => {
      const fam = c.famille_nom || 'Autres';
      if (!famMap.has(fam)) famMap.set(fam, []);
      famMap.get(fam).push(c);
    });
    const fams = [...famMap.keys()].sort((a,b)=>a.localeCompare(b,'fr'));
    let html = '';
    fams.forEach(fam => {
      const list = famMap.get(fam).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
      html += `<optgroup label="${esc(fam)}">` +
        list.map(c => `<option value="${c.id}" ${String(c.id)===String(selectedId)?'selected':''}>${esc(c.nom)}</option>`).join('') +
      `</optgroup>`;
    });
    return html;
  }

  // charge la version détaillée si dispo (avec famille_nom)
  async function getCategoriesDetailed() {
    if (window.electronAPI?.getAllCategoriesDetailed) {
      return await window.electronAPI.getAllCategoriesDetailed();
    }
    const simple = await window.electronAPI.getCategories(); // fallback
    return (simple||[]).map(c => ({...c, famille_nom: c.famille_nom || 'Autres'}));
  }

  window.buildCategoryOptionsGrouped = buildCategoryOptionsGrouped;
  window.getCategoriesDetailed = getCategoriesDetailed;
})();
