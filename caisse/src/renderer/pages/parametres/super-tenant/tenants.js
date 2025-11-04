(() => {
  async function renderTenantsAdmin() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('tenants-admin-style2')) {
      const st = document.createElement('style');
      st.id = 'tenants-admin-style2';
      st.textContent = `
        .tadmin .layout { display:grid; grid-template-columns: 320px 1fr; gap:16px; align-items:start; }
        .tadmin .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow: 0 4px 14px rgba(0,0,0,.05); }
        .tadmin .list { max-height: 70vh; overflow:auto; }
        .tadmin .row { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
        .tadmin .muted { color:#6b7280; font-size:12px; }
        .tadmin .tabs { display:flex; gap:8px; border-bottom:1px solid #eee; margin:10px 0; }
        .tadmin .tab { padding:8px 12px; border-radius:8px 8px 0 0; cursor:pointer; }
        .tadmin .tab.active { background:#f3f4f6; font-weight:600; }
        .tadmin .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        .tadmin label { font-weight:600; font-size: 12px; }
        .tadmin input[type="text"], .tadmin input[type="email"], .tadmin input[type="password"], .tadmin input[type="number"], .tadmin select { padding:6px 8px; width:100%; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="tadmin">
        <h2>Gestion des épiceries (tenants)</h2>
        <div class="muted">Créer/modifier un tenant, gérer ses modules et sa configuration e-mail.</div>
        <div class="layout">
          <div class="card">
            <h3 style="margin-top:0;">Créer un tenant</h3>
            <div class="row">
              <div style="flex:1;"><label>Nom<br><input id="t-name"></label></div>
              <div style="flex:1;"><label>Company (optionnel)<br><input id="t-company"></label></div>
              <div style="flex:1;"><label>Admin e-mail<br><input id="t-email" type="email"></label></div>
              <div style="flex:1;"><label>Mot de passe provisoire<br><input id="t-pass" type="password"></label></div>
              <div><button id="t-create" class="btn">Créer</button></div>
            </div>
            <div id="t-create-msg" class="muted" style="margin-top:6px;"></div>
            <hr style="margin:12px 0;">
            <div class="row" style="justify-content:space-between;">
              <h3 style="margin:0;">Tenants</h3>
              <button id="t-refresh" class="btn">Rafraîchir</button>
            </div>
            <div id="t-list" class="list" style="margin-top:8px;">Chargement…</div>
          </div>

          <div class="card" id="t-panel">
            <div id="t-panel-empty" class="muted">Sélectionne un tenant à gauche.</div>
            <div id="t-panel-body" style="display:none;">
              <div class="row" style="justify-content:space-between;">
                <div>
                  <h3 id="t-title" style="margin:0; display:inline-block;">Tenant</h3>
                  <code id="t-id" style="margin-left:8px;"></code>
                </div>
                <div class="row" style="gap:8px;">
                  <button id="t-delete-soft" class="btn">Supprimer</button>
                  <button id="t-delete-hard" class="btn">Supprimer définitivement</button>
                </div>
              </div>
              <div class="tabs">
                <div class="tab active" data-tab="modules">Modules</div>
                <div class="tab" data-tab="email">E-mail</div>
              </div>
              <div id="tab-modules"></div>
              <div id="tab-email" style="display:none;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (sel) => host.querySelector(sel);
    const setMsg = (el, msg) => { if (el) el.textContent = msg || ''; };
    function tabShow(which) {
      ['modules','email'].forEach(t => {
        $(`#tab-${t}`).style.display = (t===which) ? '' : 'none';
        [...host.querySelectorAll(`.tab[data-tab="${t}"]`)].forEach(tab => tab.classList.toggle('active', t===which));
      });
    }

    $('#t-create')?.addEventListener('click', async () => {
      const name = $('#t-name').value.trim();
      const email = $('#t-email').value.trim();
      const pass  = $('#t-pass').value;
      const company = $('#t-company').value.trim() || name;
      setMsg($('#t-create-msg'), 'Création…');
      try {
        const r = await window.electronAPI.adminRegisterTenant?.({ tenant_name: name, email, password: pass, company_name: company });
        if (!r?.ok) throw new Error(r?.error || 'Échec');
        setMsg($('#t-create-msg'), `✅ Créé (id: ${r.tenant_id})`);
        await loadTenants();
      } catch (e) { setMsg($('#t-create-msg'), `Erreur: ${e?.message || e}`); }
    });

    async function loadTenants() {
      const box = $('#t-list');
      if (!box) return;
      box.textContent = 'Chargement…';

      try {
        let r = null;
        if (window.electronAPI?.adminListTenants) {
          r = await window.electronAPI.adminListTenants();
        }
        if ((!r || r.ok === false) && window.ApiClient?.admin?.listTenants) {
          r = await window.ApiClient.admin.listTenants();
        }
        if (!r?.ok) {
          const reason = r?.error || 'Réponse non OK ou IPC absent';
          box.innerHTML = `<div class="muted">Impossible de charger : ${reason}</div>`;
          console.debug('[tenants] adminListTenants failed:', r);
          return;
        }

        const rows = r.tenants || [];
        if (!rows.length) {
          box.innerHTML = `<div class="muted">Aucun tenant.</div>`;
          return;
        }

        box.innerHTML = rows.map(t => `
          <div class="item" data-id="${t.id}" style="padding:8px; border:1px solid #eee; border-radius:8px; margin-bottom:6px; cursor:pointer;">
            <div><strong>${t.name || '—'}</strong></div>
            <div class="muted">${t.company_name || '—'}</div>
            <div class="muted">${t.admin_email || '—'}</div>
          </div>
        `).join('');

        box.querySelectorAll('.item').forEach(div => {
          div.addEventListener('click', () => openTenant(
            div.dataset.id,
            rows.find(x => String(x.id) === String(div.dataset.id))
          ));
        });
      } catch (e) {
        box.innerHTML = `<div class="muted">Erreur: ${e?.message || e}</div>`;
        console.error('[tenants] loadTenants error:', e);
      }
    }

    $('#t-refresh')?.addEventListener('click', loadTenants);
    await loadTenants();

    async function openTenant(tenantId, meta) {
      $('#t-panel-empty').style.display = 'none';
      $('#t-panel-body').style.display = '';
      $('#t-title').textContent = meta?.name || 'Tenant';
      $('#t-id').textContent = tenantId || '';

      await renderAdminModules(tenantId, $('#tab-modules'));
      await renderAdminEmail(tenantId, $('#tab-email'));

      host.querySelectorAll('.tab').forEach(tab => { tab.onclick = () => tabShow(tab.dataset.tab); });
      tabShow('modules');

      const btnSoft = $('#t-delete-soft');
      const btnHard = $('#t-delete-hard');

      btnSoft.onclick = async () => {
        if (!window.electronAPI?.adminTenantDelete) { alert("Suppression indisponible (IPC manquant)."); return; }
        const name = meta?.name || `tenant #${tenantId}`;
        if (!confirm(`Supprimer "${name}" ? (soft delete)`)) return;
        try {
          const r = await window.electronAPI.adminTenantDelete(tenantId, false);
          if (!r?.ok) throw new Error(r?.error || 'Échec suppression');
          alert('Tenant supprimé (soft).');
          await loadTenants();
          $('#t-panel-empty').style.display = '';
          $('#t-panel-body').style.display = 'none';
        } catch (e) { alert('Suppression impossible : ' + (e?.message || e)); }
      };

      btnHard.onclick = async () => {
        if (!window.electronAPI?.adminTenantDelete) { alert("Suppression indisponible (IPC manquant)."); return; }
        const name = meta?.name || `tenant #${tenantId}`;
        const conf = prompt(
          `SUPPRESSION DÉFINITIVE de "${name}"\n\n` +
          '⚠️ IRRÉVERSIBLE. Toutes les données seront supprimées.\n\n' +
          'Tape OUI pour confirmer :'
        );
        if (conf !== 'OUI') return;
        try {
          const r = await window.electronAPI.adminTenantDelete(tenantId, true);
          if (!r?.ok) throw new Error(r?.error || 'Échec suppression définitive');
          alert('Tenant supprimé définitivement.');
          await loadTenants();
          $('#t-panel-empty').style.display = '';
          $('#t-panel-body').style.display = 'none';
        } catch (e) { alert('Suppression impossible : ' + (e?.message || e)); }
      };
    }

    async function renderAdminModules(tenantId, container) {
      const defs = {
        adherents:   { label: "Adhérents", desc: "Gestion des membres adhérents.", children: ["cotisations", "emails", "prospects"] },
        cotisations: { label: "Cotisations", desc: "Gestion des cotisations (min 5€).", dependsOn: ["adherents"] },
        emails:      { label: "E-mails", desc: "Envoi des factures par e-mail.", dependsOn: ["adherents"] },
        modes_paiement: { label: "Modes de paiement", desc: "Sélecteur, frais, page d’admin." },
        prospects:   { label: "Prospects", desc: "Invitations et conversion.", dependsOn: ["adherents"] },
        ventes_exterieur: { label: "Vente extérieurs", desc: "Majoration configurable." },
        stocks:      { label: "Stocks", desc: "Mouvements, réceptions.", children: ["inventaire"] },
        inventaire:  { label: "Inventaire", desc: "Comptage physique.", dependsOn: ["stocks"] },
        fournisseurs:{ label: "Fournisseurs", desc: "Suivi des fournisseurs." },
        exports:     { label: "Exports / stats" },
        multiusers:  { label: "Multi-utilisateurs" }
      };

      container.innerHTML = `<div class="muted">Chargement des modules…</div>`;
      let current = {};
      try {
        const r = await window.electronAPI.adminGetTenantModules?.(tenantId);
        current = (r?.modules) || {};
      } catch {}

      let extMargin = 30;
      try {
        const res = await window.electronAPI.getVentesMargin?.();
        const v = Number(res?.percent);
        if (Number.isFinite(v) && v >= 0) extMargin = v;
      } catch {}

      const topLevel = ["adherents","ventes_exterieur","stocks","modes_paiement","fournisseurs","exports","multiusers"].filter(k => defs[k]);

      function getDepends(k){ return defs[k]?.dependsOn || []; }
      function getChildren(k){ return defs[k]?.children || []; }

      function itemHtml(key, level=0) {
        const d = defs[key]; if (!d) return '';
        const checked = !!current[key];
        const deps = getDepends(key);
        const disabled = deps.some(dep => !current[dep]);
        let h = `
          <div class="row" style="align-items:center;">
            <input type="checkbox" id="am-${key}" ${checked?'checked':''} ${disabled?'disabled':''}>
            <label for="am-${key}">${d.label}</label>
          </div>
          <div class="muted">${d.desc || ''} ${deps.length?`(dépend de: ${deps.join(', ')})`:''}</div>
        `;
        if (key==='ventes_exterieur') {
          h += `
            <div id="am-ext" class="row" style="margin-top:6px; ${checked?'':'display:none;'}">
              <label>Majoration (%)</label>
              <input id="am-ext-margin" type="number" min="0" step="0.1" value="${extMargin}" style="width:120px;">
            </div>
          `;
        }
        const kids = getChildren(key);
        const kidsHtml = kids.length ?
          `<div style="margin-left:14px; display:grid; gap:8px; margin-top:8px;">
            ${kids.map(ch => `<div class="card" style="padding:10px;">${itemHtml(ch, level+1)}</div>`).join('')}
          </div>` : '';
        return level===0 ? `<div class="card" style="margin-bottom:10px;">${h}${kidsHtml}</div>` : `${h}${kidsHtml}`;
      }

      container.innerHTML = `
        <div>
          ${topLevel.map(k => itemHtml(k)).join('')}
          <div class="row" style="gap:10px; margin-top:10px;">
            <button id="am-save" class="btn">Enregistrer</button>
            <span id="am-msg" class="muted"></span>
          </div>
        </div>
      `;

      function refreshDisabled() {
        Object.keys(defs).forEach(k => {
          const deps = getDepends(k);
          const cb  = container.querySelector(`#am-${k}`);
          if (!cb) return;
          const dis = deps.some(d => !current[d]);
          cb.disabled = dis;
          if (dis) { cb.checked = false; current[k]=false; }
        });
      }
      function ensureParents(k) {
        getDepends(k).forEach(p => {
          if (!current[p]) {
            current[p]=true;
            const cbp= container.querySelector(`#am-${p}`);
            if (cbp) cbp.checked = true;
            ensureParents(p);
          }
        });
      }

      Object.keys(defs).forEach(k => {
        const cb = container.querySelector(`#am-${k}`);
        if (!cb) return;
        cb.addEventListener('change', () => {
          if (cb.checked) { ensureParents(k); current[k]=true; }
          else {
            const stack=[k];
            while(stack.length){
              const s=stack.pop();
              current[s]=false;
              const cbs=container.querySelector(`#am-${s}`);
              if (cbs) cbs.checked=false;
              (defs[s]?.children||[]).forEach(ch=>stack.push(ch));
            }
          }
          if (k==='ventes_exterieur') {
            const b = container.querySelector('#am-ext');
            if (b) b.style.display = current.ventes_exterieur ? '' : 'none';
          }
          refreshDisabled();
          setMsg(container.querySelector('#am-msg'), 'Modifications non enregistrées…');
        });
      });
      refreshDisabled();

      container.querySelector('#am-save')?.addEventListener('click', async () => {
        try {
          const payload = { ...current };
          if (!payload.adherents) { payload.cotisations=false; payload.emails=false; payload.prospects=false; }
          if (!payload.stocks) payload.inventaire=false;

          const inp = container.querySelector('#am-ext-margin');
          if (inp) {
            let v = parseFloat(inp.value);
            if (!Number.isFinite(v)||v<0) v=30;
            await window.electronAPI.setVentesMargin?.(v);
          }
          const r = await window.electronAPI.adminSetTenantModules?.(tenantId, payload);
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          setMsg(container.querySelector('#am-msg'), 'Modules enregistrés ✅');
        } catch (e) { setMsg(container.querySelector('#am-msg'), 'Erreur: '+(e?.message||e)); }
      });
    }

    async function renderAdminEmail(tenantId, container) {
      container.innerHTML = `<div class="muted">Chargement e-mail…</div>`;

      const html = `
        <div class="grid2">
          <div><label>Provider</label>
            <select id="ae-provider">
              <option value="gmail">Gmail (mot de passe d'application)</option>
              <option value="smtp">SMTP (personnalisé)</option>
              <option value="disabled">Désactivé</option>
            </select>
          </div>
          <div><label>From (expéditeur)</label><input id="ae-from" type="text" placeholder="Coop'az <noreply@exemple.com>"></div>
          <div><label>User</label><input id="ae-user" type="text"></div>
          <div><label>Mot de passe</label><input id="ae-pass" type="password"></div>
        </div>
        <div id="ae-smtp" class="grid2" style="margin-top:8px; display:none;">
          <div><label>Host</label><input id="ae-host" type="text" placeholder="smtp.exemple.com"></div>
          <div><label>Port</label><input id="ae-port" type="number" placeholder="587"></div>
          <div class="row" style="margin-top:6px; align-items:center;">
            <input id="ae-secure" type="checkbox"><span>TLS implicite (465)</span>
          </div>
        </div>
        <div class="row" style="gap:10px; margin-top:10px;">
          <button id="ae-save" class="btn">Enregistrer</button>
          <span id="ae-msg" class="muted"></span>
        </div>
        <hr style="margin:12px 0;">
        <div class="row" style="gap:10px;">
          <input id="ae-test-to" type="email" placeholder="destinataire test">
          <button id="ae-test" class="btn">Envoyer un test</button>
          <span id="ae-test-msg" class="muted"></span>
        </div>
      `;
      container.innerHTML = html;

      const $c = (sel) => container.querySelector(sel);
      function applyProviderUI() {
        const p = $c('#ae-provider').value;
        $c('#ae-smtp').style.display = (p==='smtp') ? '' : 'none';
        const dis = (p==='disabled');
        ['#ae-from','#ae-user','#ae-pass'].forEach(sel=>{
          const el = $c(sel); if (el) el.disabled = dis;
        });
      }
      $c('#ae-provider').addEventListener('change', applyProviderUI);

      try {
        const r = await window.electronAPI.adminEmailGetSettings?.(tenantId);
        if (r?.ok) {
          const s = r.settings || {};
          $c('#ae-provider').value = s.provider || 'gmail';
          $c('#ae-from').value     = s.from || '';
          $c('#ae-user').value     = s.user || '';
          $c('#ae-pass').value      = '';
          $c('#ae-host').value     = s.host || '';
          $c('#ae-port').value     = (s.port != null ? s.port : '');
          $c('#ae-secure').checked = !!s.secure;
        } else {
          $c('#ae-msg').textContent = r?.error || 'Impossible de charger la configuration';
        }
      } catch (e) {
        $c('#ae-msg').textContent = e?.message || String(e);
      }
      applyProviderUI();

      $c('#ae-save').addEventListener('click', async () => {
        try {
          $c('#ae-msg').textContent = 'Enregistrement…';
          const payload = {
            provider: $c('#ae-provider').value,
            from: $c('#ae-from').value.trim() || undefined,
            user: $c('#ae-user').value.trim() || undefined,
            pass: $c('#ae-pass').value || undefined,
            host: $c('#ae-host').value.trim() || undefined,
            port: $c('#ae-port').value ? Number($c('#ae-port').value) : undefined,
            secure: !!$c('#ae-secure').checked,
          };
          const r = await window.electronAPI.adminEmailSetSettings?.(tenantId, payload);
          $c('#ae-pass').value = '';
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          $c('#ae-msg').textContent = 'Réglages enregistrés ✅';
        } catch (e) { $c('#ae-msg').textContent = 'Erreur: '+(e?.message||e); }
      });

      $c('#ae-test').addEventListener('click', async () => {
        const to = $c('#ae-test-to').value.trim();
        if (!to) { $c('#ae-test-msg').textContent = 'Indique un destinataire'; return; }
        try {
          $c('#ae-test-msg').textContent = 'Envoi…';
          const r = await window.electronAPI.adminEmailTestSend?.(tenantId, { to, subject: '[Test] Config e-mail tenant', text: 'Ceci est un test.' });
          if (!r?.ok) throw new Error(r?.error || 'Échec');
          $c('#ae-test-msg').textContent = 'Email de test envoyé ✅';
        } catch (e) { $c('#ae-test-msg').textContent = 'Erreur: '+(e?.message||e); }
      });
    }
  }

  window.PageParams = { ...(window.PageParams||{}), renderTenantsAdmin };
})();