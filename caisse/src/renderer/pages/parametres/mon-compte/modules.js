// src/renderer/pages/parametres/mon-compte/modules.js
(() => {
  async function getActiveModules() {
    try {
      if (window.electronAPI?.getTenantModules) {
        const r = await window.electronAPI.getTenantModules();
        if (r?.ok && r.modules) return r.modules;
      }
    } catch {}
    try {
      if (typeof window.getMods === 'function') return await window.getMods();
      if (window.electronAPI?.getModules) return await window.electronAPI.getModules();
    } catch {}
    return {};
  }
  async function saveActiveModules(modules) {
    if (window.electronAPI?.setTenantModules) {
      const r = await window.electronAPI.setTenantModules(modules);
      if (!r?.ok) throw new Error(r?.error || 'setTenantModules KO');
    }
    if (window.electronAPI?.setModules) { try { await window.electronAPI.setModules(modules); } catch {} }
  }

  async function render() {
    const container = document.getElementById('parametres-souspage');
    if (!container) return;

    const current = await getActiveModules();
    let extMargin = 30;
    try {
      const res = await window.electronAPI.getVentesMargin?.();
      const v = Number(res?.percent);
      if (Number.isFinite(v) && v >= 0) extMargin = v;
    } catch { extMargin = 30; }

    const defs = {
      adherents:   { label: "Adhérents", desc: "Gestion des membres adhérents.", children: ["cotisations", "emails", "prospects"] },
      cotisations: { label: "Cotisations", desc: "Gestion des cotisations adhérents (min 5€).", dependsOn: ["adherents"] },
      emails:      { label: "Envoi factures adhérents", desc: "Activer l'envoi des factures par e-mail aux adhérents.", dependsOn: ["emailAdmin", "adherents"] },
      emailAdmin:  { label: "E-mails admin", desc: "Configuration SMTP et destinataires des rapports (compta, technique, etc.)." },
      modes_paiement: { label: "Modes de paiement", desc: "Activer le sélecteur, les frais et la page d'admin." },
      prospects:   { label: "Prospects", desc: "Gestion prospects (dépend des adhérents).", dependsOn: ["adherents"] },
      ventes_exterieur: { label: "Vente aux extérieurs", desc: "Majoration configurable." },
      stocks:      { label: "Gestion des stocks", desc: "Mise à jour de stock & réceptions.", children: ["inventaire"] },
      inventaire:  { label: "Inventaire", desc: "Comptage physique.", dependsOn: ["stocks"] },
      fournisseurs:{ label: "Fournisseurs", desc: "Suivi des fournisseurs." },
      statistiques:{ label: "Statistiques", desc: "Tableau de bord avec graphiques et métriques de ventes/réceptions." },
      multiusers:  { label: "Multi-utilisateurs" }
    };

    if (!document.getElementById('modules-settings-style')) {
      const st = document.createElement('style');
      st.id = 'modules-settings-style';
      st.textContent = `
        .mods-wrap { max-width: 920px; }
        .mod-item { padding: 10px 12px; border: 1px solid #e6e6e6; border-radius: 10px; margin-bottom: 10px; background: #fafafa; }
        .mod-head { display:flex; align-items:center; gap:10px; }
        .mod-head label { font-weight: 700; }
        .mod-desc { color:#666; font-size: 12px; margin-left: 28px; margin-top: 4px; }
        .mod-children { margin-left: 22px; margin-top: 8px; display: grid; gap: 8px; }
        .mod-child { padding: 8px 10px; border: 1px dashed #ddd; border-radius: 8px; background: #fff; }
        .pill { display:inline-block; font-size:11px; padding:2px 6px; border-radius:999px; background:#eef3ff; border:1px solid #d7e2ff; color:#3756c5; margin-left: 6px; }
        .muted { color:#999; font-size: 12px; }
        .hr { height: 1px; background: #eee; margin: 14px 0; }
        input[type="number"] { padding: 6px 8px; }
      `;
      document.head.appendChild(st);
    }

    const getDepends = (key) => (defs[key]?.dependsOn || []);
    const getChildren = (key) => (defs[key]?.children || []);

    const renderItem = (key, level = 0) => {
      const def = defs[key]; if (!def) return '';
      const checked = !!current[key];
      const deps = getDepends(key);
      const disabled = deps.some(d => !current[d]);

      let headHtml = `
        <div class="mod-head">
          <input type="checkbox" id="mod-${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <label for="mod-${key}">${def.label}</label>
          ${deps.length ? `<span class="pill">dépend de : ${deps.join(', ')}</span>` : ''}
        </div>
        <div class="mod-desc">${def.desc || ''}</div>
      `;

      if (key === 'ventes_exterieur') {
        headHtml += `
          <div class="ext-margin" id="ext-margin-block" style="${checked ? '' : 'display:none;'}; margin-left:28px; margin-top:8px; display:flex; align-items:center; gap:8px;">
            <label>Majoration (%)</label>
            <input type="number" id="ext-margin-input" min="0" step="0.1" value="${extMargin}">
          </div>
        `;
      }

      const children = getChildren(key);
      const childrenHtml = children.length
        ? `<div class="mod-children">
            ${children.map(child => `
              <div class="mod-child" data-child-of="${key}">
                ${renderItem(child, level + 1)}
              </div>
            `).join('')}
          </div>` : '';

      return level === 0
        ? `<div class="mod-item" data-module="${key}">${headHtml}${childrenHtml}</div>`
        : `${headHtml}${childrenHtml}`;
    };

    const topLevelOrder = ["adherents", "emailAdmin", "ventes_exterieur", "stocks", "modes_paiement", "fournisseurs", "statistiques", "multiusers"]
      .filter(k => defs[k]);

    const html = `
      <div class="mods-wrap">
        <h2>Activation des modules</h2>
        <div class="muted">Activez/désactivez les modules. Les dépendances sont gérées automatiquement.</div>
        <div class="hr"></div>
        ${topLevelOrder.map(k => renderItem(k)).join('')}
        <div style="margin-top:16px; display:flex; gap:10px; align-items:center;">
          <button id="save-modules" class="btn">Enregistrer</button>
          <span class="muted" id="save-hint"></span>
        </div>
      </div>
    `;
    container.innerHTML = html;

    function refreshDisabledStates() {
      Object.keys(defs).forEach(key => {
        const deps = getDepends(key);
        const cb = document.getElementById(`mod-${key}`);
        if (!cb) return;
        const mustDisable = deps.some(d => !current[d]);
        cb.disabled = mustDisable;
        if (mustDisable) { cb.checked = false; current[key] = false; }
      });
    }
    function ensureParentsFor(key) {
      const deps = getDepends(key);
      deps.forEach(p => {
        if (!current[p]) {
          current[p] = true;
          const cbp = document.getElementById(`mod-${p}`);
          if (cbp) cbp.checked = true;
          ensureParentsFor(p);
        }
      });
    }

    Object.keys(defs).forEach(key => {
      const cb = document.getElementById(`mod-${key}`);
      if (!cb) return;
      cb.addEventListener('change', () => {
        const newVal = cb.checked;
        if (newVal) {
          ensureParentsFor(key); current[key] = true;
        } else {
          const stack = [key];
          while (stack.length) {
            const k = stack.pop();
            current[k] = false;
            const cbox = document.getElementById(`mod-${k}`);
            if (cbox) cbox.checked = false;
            (defs[k]?.children || []).forEach(ch => stack.push(ch));
          }
        }
        if (key === 'ventes_exterieur') {
          const block = document.getElementById('ext-margin-block');
          if (block) block.style.display = current.ventes_exterieur ? '' : 'none';
        }
        refreshDisabledStates();
        document.getElementById('save-hint').textContent = 'Modifications non enregistrées…';
      });
    });

    refreshDisabledStates();

    document.getElementById('save-modules')?.addEventListener('click', async () => {
      const saveBtn = document.getElementById('save-modules');
      const saveHint = document.getElementById('save-hint');
      try {
        if (saveBtn) saveBtn.disabled = true;
        if (saveHint) saveHint.textContent = 'Enregistrement en cours…';

        const payload = { ...current };
        if (typeof payload.emails === 'boolean') payload.email = payload.emails;
        if (typeof payload.email  === 'boolean') payload.emails = payload.email;

        if (!payload.adherents) { payload.cotisations = false; payload.emails = false; payload.email = false; payload.prospects = false; }
        if (!payload.stocks) payload.inventaire = false;
        if (!payload.fournisseurs) payload.receptions = false;

        const input = document.getElementById('ext-margin-input');
        if (input) {
          let v = parseFloat(input.value);
          if (!Number.isFinite(v) || v < 0) v = 30;
          await window.electronAPI.setVentesMargin?.(v);
        }

        await saveActiveModules(payload);
        
        // Mettre à jour le config.json local
        if (window.electronAPI?.updateLocalConfig) {
          await window.electronAPI.updateLocalConfig({ modules: payload });
        }

        if (window.clearModsCache) window.clearModsCache();
        if (saveHint) saveHint.textContent = '✓ Modules enregistrés avec succès';
        setTimeout(() => { if (saveHint) saveHint.textContent = ''; }, 3000);
        // window.location.reload(); // Suppression du reload automatique pour préserver la page courante
      } catch (e) {
        if (saveHint) saveHint.textContent = '';
        alert("Erreur lors de l'enregistrement : " + (e?.message || e));
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  window.PageParamsModules = { render };
})();
