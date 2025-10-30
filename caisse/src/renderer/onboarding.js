// src/renderer/onboarding.js

(function () {
  const $ = (s) => document.querySelector(s);

  // Sélecteurs
  const elErr = $('#err');
  const elBtn = $('#btn');
  const elLogo = $('#logo');
  const elPreview = $('#preview');

  const checkIds = [
    'm_adherents', 'm_cotisations', 'm_emails', 'm_stocks', 'm_inventaire',
    'm_fournisseurs', 'm_exports', 'm_multiusers', 'm_ventes_exterieur',
    'm_prospects', 'm_modes_paiement'
  ];

  const smtpFields = {
    host:  $('#smtp_host'),
    port:  $('#smtp_port'),
    user:  $('#smtp_user'),
    pass:  $('#smtp_pass'),
    from:  $('#smtp_from'),
    secure:$('#smtp_secure'),
  };

  let logoB64 = null;

  // Utilitaires
  function setError(msg) {
    if (!elErr) return;
    elErr.textContent = msg || '';
  }

  function toB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function setSmtpDisabled(disabled) {
    Object.values(smtpFields).forEach((el) => {
      if (el) el.disabled = !!disabled;
    });
  }

  function readModules() {
    const get = (id) => !!$('#' + id)?.checked;
    return {
      adherents:        get('m_adherents'),
      cotisations:      get('m_cotisations'),
      emails:           get('m_emails'),
      stocks:           get('m_stocks'),
      inventaire:       get('m_inventaire'),
      fournisseurs:     get('m_fournisseurs'),
      exports:          get('m_exports'),
      multiusers:       get('m_multiusers'),
      ventes_exterieur: get('m_ventes_exterieur'),
      prospects:        get('m_prospects'),
      modes_paiement:   get('m_modes_paiement'),
    };
  }

  function readSmtp(modules) {
    if (!modules.emails) return null;
    return {
      host:   smtpFields.host?.value.trim() || null,
      port:   Number(smtpFields.port?.value) || null,
      user:   smtpFields.user?.value.trim() || null,
      pass:   smtpFields.pass?.value || null,
      from:   smtpFields.from?.value.trim() || null,
      secure: smtpFields.secure?.value || 'starttls',
    };
  }

  // Événements
  if (elLogo) {
    elLogo.addEventListener('change', async (e) => {
      setError('');
      try {
        const f = e.target.files?.[0];
        if (!f) { logoB64 = null; if (elPreview) elPreview.style.display = 'none'; return; }
        logoB64 = await toB64(f);
        if (elPreview) {
          elPreview.src = logoB64;
          elPreview.style.display = 'block';
        }
      } catch (err) {
        setError(err?.message || String(err));
      }
    });
  }

  // Active/désactive SMTP quand on coche "Emails"
  const emailsCheckbox = $('#m_emails');
  if (emailsCheckbox) {
    emailsCheckbox.addEventListener('change', () => {
      setSmtpDisabled(!emailsCheckbox.checked);
    });
  }

  if (elBtn) {
    elBtn.addEventListener('click', async () => {
      setError('');

      try {
        const modules = readModules();
        const smtp = readSmtp(modules);
        const pwd = ($('#pwd')?.value || '').trim();

        if (pwd && pwd.length < 6) {
          setError('Mot de passe trop court (min. 6).');
          return;
        }

        const payload = {
          new_password: pwd || null,
          modules,
          smtp,
          logo_base64: logoB64 || null,
        };

        const res = await window.electronAPI.submitOnboarding(payload);
        if (!res || !res.ok) {
          throw new Error(res?.error || "Impossible d’enregistrer.");
        }

        await window.electronAPI.goMain();
      } catch (err) {
        setError(err?.message || String(err));
      }
    });
  }

  // Pré-remplissage
  (async function init() {
    setError('');
    try {
      const r = await window.electronAPI.getOnboardingStatus();
      if (!r?.ok) {
        // Pas bloquant : on laisse l’utilisateur remplir à la main
        return;
      }
      const s = r.status || {};

      // Modules
      if (s.modules) {
        const m = s.modules || {};
        const set = (id, v) => { const el = $('#' + id); if (el) el.checked = !!v; };
        set('m_adherents',        m.adherents);
        set('m_cotisations',      m.cotisations);
        set('m_emails',           m.emails || m.email);
        set('m_stocks',           m.stocks);
        set('m_inventaire',       m.inventaire);
        set('m_fournisseurs',     m.fournisseurs);
        set('m_exports',          m.exports);
        set('m_multiusers',       m.multiusers);
        set('m_ventes_exterieur', m.ventes_exterieur);
        set('m_prospects',        m.prospects);
        set('m_modes_paiement',   m.modes_paiement);

        // Ajuste l’état des champs SMTP
        const emailsOn = !!(m.emails || m.email);
        setSmtpDisabled(!emailsOn);
      } else {
        // Si on n’a pas l’info de modules, on désactive SMTP par défaut si la case n’est pas cochée
        setSmtpDisabled(!$('#m_emails')?.checked);
      }

      // Logo (url déjà existante côté API)
      if (s.logo_url && elPreview) {
        elPreview.src = s.logo_url;
        elPreview.style.display = 'block';
      }

      // SMTP (si l’API renvoie déjà un bloc smtp)
      if (s.smtp) {
        if (smtpFields.host)   smtpFields.host.value   = s.smtp.host   || '';
        if (smtpFields.port)   smtpFields.port.value   = s.smtp.port   || '';
        if (smtpFields.user)   smtpFields.user.value   = s.smtp.user   || '';
        if (smtpFields.from)   smtpFields.from.value   = s.smtp.from   || '';
        if (smtpFields.secure) smtpFields.secure.value = s.smtp.secure || 'starttls';
        // Par sécurité, ne jamais pré-remplir le mot de passe SMTP
      }
    } catch (_) {
      // silencieux : on laisse l’utilisateur remplir à la main
    }
  })();
})();
