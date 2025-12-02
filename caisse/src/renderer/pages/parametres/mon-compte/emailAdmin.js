// src/renderer/pages/parametres/mon-compte/emailAdmin.js
(() => {
  async function render() {
    const host = document.getElementById('parametres-souspage') || document.getElementById('page-content');
    if (!host) return;

    if (!document.getElementById('email-admin-settings-style')) {
      const st = document.createElement('style');
      st.id = 'email-admin-settings-style';
      st.textContent = `
        .email-admin-settings .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px; box-shadow:0 4px 14px rgba(0,0,0,.05); max-width:760px; }
        .email-admin-settings .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
        .email-admin-settings .row > div { display:flex; flex-direction:column; gap:6px; flex:1 1 260px; }
        .email-admin-settings .muted { color:#6b7280; font-size:12px; }
        .email-admin-settings .hr { height:1px; background:#eee; margin:14px 0; }
        .email-admin-settings input[type="text"], .email-admin-settings input[type="email"], .email-admin-settings input[type="password"], .email-admin-settings input[type="number"], .email-admin-settings select { padding:6px 8px; }
        .email-admin-settings .info-box { background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px; margin-top:12px; }
        .email-admin-settings .info-box p { margin:4px 0; font-size:13px; color:#0369a1; }
      `;
      document.head.appendChild(st);
    }

    host.innerHTML = `
      <div class="email-admin-settings">
        <div class="card">
          <h2 style="margin:0 0 8px 0;">Configuration des e-mails</h2>
          <div class="muted">Configuration de l'envoi des e-mails (factures, rapports, etc.).</div>
          <div class="hr"></div>

          <h3 style="margin:10px 0 8px 0;">Serveur d'envoi (SMTP)</h3>
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
              <div style="display:flex; align-items:center; gap:8px;">
                <input id="email-pass" type="password" style="flex:1;">
                <button type="button" id="toggle-pass" class="btn">Afficher</button>
              </div>
            </div>
          </div>

          <div id="smtp-block" style="display:none;">
            <div class="row">
              <div><label>Host<br><input id="smtp-host" type="text" placeholder="smtp.exemple.com"></label></div>
              <div><label>Port<br><input id="smtp-port" type="number" placeholder="587"></label></div>
              <div style="display:flex; align-items:center; gap:6px; margin-top:8px;">
                <input id="smtp-secure" type="checkbox">
                <label for="smtp-secure">Secure (TLS implicite 465)</label>
              </div>
            </div>
          </div>

          <div class="row" style="margin-top:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <input id="email-test-to" type="email" placeholder="destinataire test (ton email)">
              <button id="btn-email-test" class="btn">Envoyer un test</button>
              <span id="email-test-msg" class="muted"></span>
            </div>
          </div>

          <div class="hr"></div>
          <h3 style="margin:10px 0;">Destinataires des rapports administratifs</h3>

          <div class="row">
            <div>
              <label>Comptable</label>
              <input id="comptable" type="email" placeholder="compta@example.com">
              <span class="muted">Recevra les bilans financiers et rapports comptables</span>
            </div>
          </div>

          <div class="row">
            <div>
              <label>Équipe technique</label>
              <input id="equipe-technique" type="email" placeholder="support@example.com">
              <span class="muted">Recevra les rapports techniques et alertes système</span>
            </div>
          </div>

          <div class="row">
            <div>
              <label>Autres destinataires</label>
              <input id="autres" type="text" placeholder="autre1@example.com, autre2@example.com">
              <span class="muted">Liste d'adresses séparées par des virgules</span>
            </div>
          </div>

          <div class="info-box">
            <p><strong>ℹ️ Note :</strong> Ces adresses seront utilisées pour l'envoi automatique des rapports suivants :</p>
            <p>• Bilans d'inventaire</p>
            <p>• Rapports hebdomadaires de ventes</p>
            <p>• Alertes de stock</p>
            <p>• Autres notifications administratives</p>
          </div>

          <div class="hr"></div>

          <div class="row">
            <div style="display:flex; gap:8px; align-items:center;">
              <button id="btn-save" class="btn">Enregistrer</button>
              <span id="save-msg" class="muted"></span>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (id) => host.querySelector(`#${id}`);

    const els = {
      provider: $('email-provider'),
      from: $('email-from'),
      user: $('email-user'),
      pass: $('email-pass'),
      toggle: $('toggle-pass'),
      smtp: $('smtp-block'),
      host: $('smtp-host'),
      port: $('smtp-port'),
      secure: $('smtp-secure'),
      testTo: $('email-test-to'),
      testBtn: $('btn-email-test'),
      testMsg: $('email-test-msg'),
      comptable: $('comptable'),
      equipeTechnique: $('equipe-technique'),
      autres: $('autres'),
      save: $('btn-save'),
      saveMsg: $('save-msg'),
    };

    function setMsg(el, msg, ok = true) {
      if (!el) return;
      el.textContent = msg || '';
      el.classList.remove('ok', 'danger');
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

    // Charger les paramètres existants
    try {
      const r = await window.electronAPI.getEmailAdminSettings?.();
      if (r?.ok) {
        const s = r.settings || {};
        // Config SMTP
        els.provider.value = s.provider || 'gmail';
        els.from.value = s.from || '';
        els.user.value = s.user || '';
        els.pass.value = '';
        els.host.value = s.host || '';
        els.port.value = (s.port != null ? s.port : '');
        els.secure.checked = !!s.secure;
        // Destinataires
        els.comptable.value = s.comptable || '';
        els.equipeTechnique.value = s.equipe_technique || '';
        els.autres.value = s.autres || '';
      } else {
        setMsg(els.saveMsg, r?.error || 'Impossible de charger la configuration', false);
      }
    } catch (e) {
      setMsg(els.saveMsg, e?.message || String(e), false);
    }
    applyProviderUI();

    // Test email
    els.testBtn.addEventListener('click', async () => {
      const to = els.testTo.value.trim();
      if (!to) return setMsg(els.testMsg, 'Indique une adresse destinataire pour le test', false);
      try {
        setMsg(els.testMsg, 'Envoi du test…', true);
        const r = await window.electronAPI.emailTestSend?.({
          to, subject: '[Test] Coopaz multi-tenant', text: 'Ceci est un test de configuration.'
        });
        if (!r?.ok) return setMsg(els.testMsg, r?.error || 'Échec de l\'envoi du test', false);
        setMsg(els.testMsg, 'Email de test envoyé ✅', true);
      } catch (e) {
        setMsg(els.testMsg, e?.message || String(e), false);
      }
    });

    // Enregistrer les paramètres
    els.save.addEventListener('click', async () => {
      try {
        setMsg(els.saveMsg, 'Enregistrement…', true);
        const payload = {
          // Config SMTP
          provider: els.provider.value,
          from: els.from.value.trim() || undefined,
          user: els.user.value.trim() || undefined,
          // Ne pas envoyer pass s'il est vide (pour garder l'ancien mot de passe)
          pass: els.pass.value ? els.pass.value : undefined,
          host: els.host.value.trim() || undefined,
          port: els.port.value ? Number(els.port.value) : undefined,
          secure: !!els.secure.checked,
          // Destinataires
          comptable: els.comptable.value.trim() || undefined,
          equipe_technique: els.equipeTechnique.value.trim() || undefined,
          autres: els.autres.value.trim() || undefined,
        };
        const r = await window.electronAPI.setEmailAdminSettings?.(payload);
        els.pass.value = '';
        if (!r?.ok) return setMsg(els.saveMsg, r?.error || 'Échec de l\'enregistrement', false);
        setMsg(els.saveMsg, 'Configuration enregistrée ✅', true);
      } catch (e) {
        setMsg(els.saveMsg, e?.message || String(e), false);
      }
    });
  }

  window.PageParamsEmailAdmin = { render };
})();
