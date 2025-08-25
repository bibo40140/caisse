// src/renderer/ui/searchable-select.js
(() => {
  if (window.__SearchableSelectReady) return;
  window.__SearchableSelectReady = true;

  const PLACEHOLDER_PREFIX = /^[-–—]{2}\s*/;
  const isPlaceholderLabel = (s) => PLACEHOLDER_PREFIX.test(String(s || '').trim());

  function makeGroupsFromSelect(sel) {
    const groups = [];
    let orphan = { label: '', options: [] };
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') {
        const g = { label: node.label || '', options: [] };
        for (const opt of node.children) {
          if (opt.tagName === 'OPTION') {
            g.options.push({ value: opt.value, label: opt.textContent || opt.label || '' });
          }
        }
        if (g.options.length) groups.push(g);
      } else if (node.tagName === 'OPTION') {
        orphan.options.push({ value: node.value, label: node.textContent || node.label || '' });
      }
    }
    if (orphan.options.length) groups.unshift(orphan);
    return groups;
  }

  function wireOne(sel) {
    if (!sel || sel.dataset.ssWired) return;
    sel.dataset.ssWired = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ss-root';
    wrap.style.position = 'relative';
    wrap.style.width = sel.style.width || '100%';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ss-input';
    input.placeholder = sel.dataset.placeholder || 'Rechercher une catégorie…';
    Object.assign(input.style, {
      width:'100%', padding:'8px 10px', border:'1px solid #ddd', borderRadius:'8px'
    });

    const list = document.createElement('div');
    list.className = 'ss-list';
    Object.assign(list.style, {
      position:'absolute', zIndex:10000, left:0, right:0, top:'calc(100% + 6px)',
      maxHeight:'260px', overflow:'auto', background:'#fff',
      border:'1px solid #ddd', borderRadius:'10px',
      boxShadow:'0 6px 24px rgba(0,0,0,0.08)', display:'none'
    });

    const groups = makeGroupsFromSelect(sel);
    const optionsFlat = groups.flatMap(g => g.options);
    const findOptionByValue = (v) => optionsFlat.find(o => String(o.value) === String(v));
    const isPlaceholderOpt = (opt) => !opt || opt.value === '' || isPlaceholderLabel(opt.label);

    // cache le select d’origine
    sel.style.display = 'none';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(input);
    wrap.appendChild(list);
    wrap.appendChild(sel);

    let current = -1;
    let pristine = true;

    const norm = (s) => String(s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    function openList(){ list.style.display = 'block'; }
    function closeList(){ list.style.display = 'none'; }

    function render(filterStr){
      const f = norm(filterStr);
      list.innerHTML = ''; current = -1;
      let any = false;

      groups.forEach(g => {
        const items = g.options.filter(o => !f || norm(o.label).includes(f));
        if (!items.length) return;

        if (g.label) {
          const head = document.createElement('div');
          head.textContent = g.label;
          head.className = 'ss-group';
          Object.assign(head.style, {
            padding:'6px 10px', fontSize:'12px', color:'#666', background:'#f7f9ff',
            borderTop:'1px solid #eef2ff'
          });
          list.appendChild(head);
        }

        items.forEach(opt => {
          const d = document.createElement('div');
          d.textContent = opt.label;
          d.className = 'ss-item';
          Object.assign(d.style, { padding:'8px 10px', cursor:'pointer' });
          d.addEventListener('mouseenter', () => { d.style.background = '#f2f6ff'; });
          d.addEventListener('mouseleave', () => { d.style.background = ''; });
          d.addEventListener('mousedown', (e) => {
            e.preventDefault();
            sel.value = opt.value;
            input.value = isPlaceholderOpt(opt) ? '' : opt.label;
            pristine = true;
            closeList();
            sel.dispatchEvent(new Event('change', { bubbles:true }));
          });
          list.appendChild(d);
          any = true;
        });
      });

      if (!any) {
        const d = document.createElement('div');
        d.textContent = 'Aucun résultat';
        d.style.padding = '8px 10px'; d.style.color = '#777';
        list.appendChild(d);
      }
    }

    // Toujours la liste complète au focus/clic
    input.addEventListener('focus', () => { openList(); render(''); });
    input.addEventListener('click',  () => { openList(); render(''); });

    // 1ère frappe : efface le texte et lance un nouveau filtre
    input.addEventListener('keydown', (e) => {
      const isPrintable = e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === ' ' || e.key === 'Spacebar';
      if (pristine && isPrintable) { input.value = ''; pristine = false; }

      // nav clavier
      const items = Array.from(list.querySelectorAll('.ss-item'));
      if (items.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); current = Math.min(current + 1, items.length - 1); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); current = Math.max(current - 1, 0); }
        if (e.key === 'Enter')     { e.preventDefault(); if (current >= 0) items[current].dispatchEvent(new Event('mousedown')); }
        if (e.key === 'Escape')    { e.preventDefault(); closeList(); input.blur(); }
        items.forEach((el, i) => el.style.background = (i === current) ? '#e9f1ff' : '');
        const active = items[current]; if (active) active.scrollIntoView({ block: 'nearest' });
      }
    });

    input.addEventListener('input', () => { openList(); render(input.value); });

    document.addEventListener('mousedown', (e) => { if (!wrap.contains(e.target)) closeList(); });

    // texte initial
    const initial = findOptionByValue(sel.value);
    input.value = isPlaceholderOpt(initial) ? '' : (initial?.label || '');
    pristine = true;

    // ⚡️ Sync auto quand la valeur du <select> change (même par code)
    sel.addEventListener('change', () => {
      const selected = findOptionByValue(sel.value);
      input.value = isPlaceholderOpt(selected) ? '' : (selected?.label || '');
      // on revient en état "pristine" pour effacer à la 1re frappe
      pristine = true;
    });

    render('');
  }

  function wireAll(ctx) {
    (ctx || document).querySelectorAll('select.select-categorie, select.select-categorie-conflit').forEach(sel => {
      if (!sel.dataset.placeholder) sel.dataset.placeholder = 'Rechercher une catégorie…';
      wireOne(sel);
    });
  }

  // auto-init sur la page entière
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireAll(document));
  } else {
    wireAll(document);
  }

  // Observe TOUT le body (n’importe quelle page qui injecte des selects)
  const obs = new MutationObserver((mut) => {
    for (const m of mut) {
      m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType === 1) wireAll(n); });
    }
  });
  obs.observe(document.body, { childList:true, subtree:true });

  // API publique
  window.SearchableSelect = {
    wire: wireOne,
    init: wireAll,
    // Permet de forcer l’alignement input ← select quand on a changé la valeur par code
    sync(sel){
      try {
        if (!sel) return;
        const wrap = sel.closest('.ss-root');
        const input = wrap?.querySelector('.ss-input');
        if (!input) return;
        const groups = makeGroupsFromSelect(sel);
        const optionsFlat = groups.flatMap(g => g.options);
        const selected = optionsFlat.find(o => String(o.value) === String(sel.value));
        input.value = (!selected || selected.value==='' || isPlaceholderLabel(selected.label)) ? '' : (selected.label || '');
      } catch {/* noop */}
    }
  };
})();
