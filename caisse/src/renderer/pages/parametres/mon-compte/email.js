// src/renderer/pages/parametres/mon-compte/email.js
(() => {
  async function render() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('email-settings-style')) {
      const st = document.createElement('style');
      st.id = 'email-settings-style';
      st.textContent = `
        .email-settings .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); max-width:760px; }
        .email-settings .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
        .email-settings .row > div { display:flex; flex-direction:column; gap:6px; }
        .email-settings .muted { color:#6b7280; font-size:12px; }
        .email-settings .hr { height:1px; background:#eee; margin:14px 0; }
        .email-settings .inline { display:flex; align-items:center; gap:8px; }
        .email-settings input[type="text"], .email-settings input[type="email"], .email-settings input[type="password"], .email-settings input[type="number"], .email-settings select { padding:6px 8px; }
        .email-settings code { padding: 2px 6px; background: #f3f4f6; border-radius: 6px; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="email-settings">
        <div class="card">
          <h2 style="margin:0 0 8px 0;">Réglages e-mail d’envoi</h2>
          <div class="muted">Configure l’adresse expéditrice et, si besoin, ton serveur SMTP.</div>
          <div class="hr"></div>

          <div class="row">
            <div>
              <label>Provider</label>
              <select id="email-provider">
                <option value="gmail">Gmail (mot de passe d'application)</option>
                <option value="smtp">SMTP (personnalisé)</option>
                <option value="disabled">Désactivé</option>
              </select>
            </div>
            <div style="flex:1 1 260px;">
              <label>From (expéditeur)</label>
              <input id="email-from" type="text" placeholder="ex: Coop'az <noreply@exemple.com>">
            </div>
          </div>

          <div class="row">
            <div style="flex:1 1 260px;">
              <label>User (login)</label>
              <input id="email-user" type="text" placeholder="utilisateur SMTP ou Gmail">
            </div>
            <div style="flex:1 1 260px;">
              <label>Mot de passe</label>
              <div class="inline">
                <input id="email-pass" type="password" style="flex:1;">
                <button type="button" id="toggle-pass" class="btn">Afficher</button>
              </div>
            </div>
          </div>

          <div id="smtp-block" style="display:none;">
            <div class="row">
              <div><label>Host<br><input id="smtp-host" type="text" placeholder="smtp.exemple.com"></label></div>
              <div><label>Port<br><input id="smtp-port" type="number" placeholder="587"></label></div>
              <div class="inline" style="align-items:center; gap:6px; margin-top:8px;">
                <input id="smtp-secure" type="checkbox">
                <label for="smtp-secure">Secure (TLS implicite 465)</label>
              </div>
            </div>
          </div>

          <div class="hr"></div>

          <div class="row">
            <div class="inline" style="gap:8px;">
              <button id="btn-email-save" class="btn">Enregistrer</button>
              <span id="email-save-msg" class="muted"></span>
            </div>
          </div>

          <div class="row" style="margin-top:8px;">
            <div class="inline" style="gap:8px;">
              <input id="email-test-to" type="email" placeholder="destinataire test (ton email)">
              <button id="btn-email-test" class="btn">Envoyer un test</button>
              <span id="email-test-msg" class="muted"></span>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (id) => host.querySelector(`#${id}`);

    const els = {
      provider: $('email-provider'),
      from:     $('email-from'),
      user:     $('email-user'),
      pass:     $('email-pass'),
      toggle:   $('toggle-pass'),
      smtp:     $('smtp-block'),
      host:     $('smtp-host'),
      port:     $('smtp-port'),
      secure:   $('smtp-secure'),
      save:     $('btn-email-save'),
      saveMsg:  $('email-save-msg'),
      testTo:   $('email-test-to'),
      testBtn:  $('btn-email-test'),
      testMsg:  $('email-test-msg'),
    };
    function setMsg(el, msg, ok=true) {
      if (!el) return;
      el.textContent = msg || '';
      el.classList.remove('ok','danger');
      if (!ok) el.classList.add('danger');
    }
    function applyProviderUI() {
      const p = els.provider.value;
      const isSMTP = p === 'smtp';
      const isDisabled = p === 'disabled';
      els.smtp.style.display = isSMTP ? '' : 'none';
      els.from.disabled = isDisabled;
      els.user.disabled = isDisabled;
      els.pass.disabled = isDisabled;
    }
    els.provider.addEventListener('change', applyProviderUI);
    els.toggle.addEventListener('click', () => {
      els.pass.type = (els.pass.type === 'password') ? 'text' : 'password';
      els.toggle.textContent = (els.pass.type === 'password') ? 'Afficher' : 'Masquer';
    });

    try {
      const r = await window.electronAPI.emailGetSettings?.();
      if (r?.ok) {
        const s = r.settings || {};
        els.provider.value = s.provider || 'gmail';
        els.from.value     = s.from || '';
        els.user.value     = s.user || '';
        els.pass.value     = '';
        els.host.value     = s.host || '';
        els.port.value     = (s.port != null ? s.port : '');
        els.secure.checked = !!s.secure;
      } else {
        setMsg(els.saveMsg, r?.error || 'Impossible de charger la configuration', false);
      }
    } catch (e) {
      setMsg(els.saveMsg, e?.message || String(e), false);
    }
    applyProviderUI();

    els.save.addEventListener('click', async () => {
      try {
        setMsg(els.saveMsg, 'Enregistrement…', true);
        const payload = {
          provider: els.provider.value,
          from: els.from.value.trim() || undefined,
          user: els.user.value.trim() || undefined,
          pass: els.pass.value || undefined,
          host: els.host.value.trim() || undefined,
          port: els.port.value ? Number(els.port.value) : undefined,
          secure: !!els.secure.checked,
        };
        const r = await window.electronAPI.emailSetSettings?.(payload);
        els.pass.value = '';
        if (!r?.ok) return setMsg(els.saveMsg, r?.error || 'Échec de l’enregistrement', false);
        setMsg(els.saveMsg, 'Réglages enregistrés ✅', true);
      } catch (e) {
        setMsg(els.saveMsg, e?.message || String(e), false);
      }
    });

    els.testBtn.addEventListener('click', async () => {
      const to = els.testTo.value.trim();
      if (!to) return setMsg(els.testMsg, 'Indique une adresse destinataire pour le test', false);
      try {
        setMsg(els.testMsg, 'Envoi du test…', true);
        const r = await window.electronAPI.emailTestSend?.({
          to, subject: '[Test] Coopaz multi-tenant', text: 'Ceci est un test de configuration.'
        });
        if (!r?.ok) return setMsg(els.testMsg, r?.error || 'Échec de l’envoi du test', false);
        setMsg(els.testMsg, 'Email de test envoyé ✅', true);
      } catch (e) {
        setMsg(els.testMsg, e?.message || String(e), false);
      }
    });
  }

  window.PageParamsEmail = { render };
})();
