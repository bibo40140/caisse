// src/renderer/onboarding-new.js - Wizard moderne en 3 étapes

(function () {
  let currentStep = 1;
  const totalSteps = 3;
  let logoB64 = null;

  // Sélecteurs
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const elError = $('#error');
  const elBtnPrev = $('#btn-prev');
  const elBtnNext = $('#btn-next');
  const elBtnFinish = $('#btn-finish');
  const elBtnSkip = $('#btn-skip');
  const elLogo = $('#logo');
  const elPreview = $('#preview');
  const elLogoUploadArea = $('#logo-upload-area');

  // === UTILITAIRES ===
  function setError(msg) {
    if (!elError) return;
    elError.textContent = msg || '';
    elError.classList.toggle('show', !!msg);
  }

  function toB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // === NAVIGATION ===
  function goToStep(step) {
    if (step < 1 || step > totalSteps) return;
    currentStep = step;

    // Mettre à jour les steps
    $$('.progress-step').forEach(el => {
      const stepNum = parseInt(el.dataset.step);
      el.classList.toggle('active', stepNum === currentStep);
      el.classList.toggle('completed', stepNum < currentStep);
    });

    // Mettre à jour le contenu
    $$('.step-content').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.step) === currentStep);
    });

    // Mettre à jour les boutons
    elBtnPrev.style.display = currentStep > 1 ? 'inline-block' : 'none';
    elBtnNext.style.display = currentStep < totalSteps ? 'inline-block' : 'none';
    elBtnFinish.style.display = currentStep === totalSteps ? 'inline-block' : 'none';

    // Mettre à jour le SMTP visibility si on arrive sur step 2
    if (currentStep === 2) {
      updateSmtpVisibility();
    }

    setError('');
  }

  function updateSmtpVisibility() {
    const emailsEnabled = $('#m_emails')?.checked;
    const smtpSection = $('#smtp-section');
    if (smtpSection) {
      smtpSection.style.display = emailsEnabled ? 'block' : 'none';
    }
  }

  // === DÉPENDANCES DES MODULES ===
  const moduleDependencies = {
    cotisations: ['adherents'],      // Cotisations nécessite Adhérents
    emailAdmin: ['emails'],          // Rapports auto nécessite Emails
    receptions: ['fournisseurs'],    // Réceptions nécessite Fournisseurs
  };

  function checkModuleDependencies() {
    Object.keys(moduleDependencies).forEach(moduleId => {
      const checkbox = $('#m_' + moduleId);
      const card = checkbox?.closest('.module-card');
      if (!checkbox || !card) return;

      const dependencies = moduleDependencies[moduleId];
      const allDepsActive = dependencies.every(depId => $('#m_' + depId)?.checked);

      if (!allDepsActive) {
        // Désactiver le module si dépendances non satisfaites
        checkbox.checked = false;
        checkbox.disabled = true;
        card.classList.add('disabled');
        card.classList.remove('selected');
      } else {
        // Réactiver si dépendances satisfaites
        checkbox.disabled = false;
        card.classList.remove('disabled');
      }
    });
  }

  // === MODULE CARDS ===
  $$('.module-card').forEach(card => {
    const checkbox = card.querySelector('input[type="checkbox"]');
    
    // Click sur la card = toggle checkbox
    card.addEventListener('click', (e) => {
      if (e.target === checkbox) return; // Éviter double toggle
      if (card.classList.contains('disabled')) return; // Bloquer si disabled
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    // Change checkbox = visual + check dépendances
    checkbox.addEventListener('change', () => {
      card.classList.toggle('selected', checkbox.checked);
      
      // Si c'est emails, mettre à jour SMTP visibility
      if (checkbox.id === 'm_emails') {
        updateSmtpVisibility();
      }

      // Vérifier les dépendances de tous les modules
      checkModuleDependencies();
    });
  });

  // Vérifier les dépendances au chargement
  checkModuleDependencies();

  // === LOGO UPLOAD ===
  if (elLogo) {
    elLogo.addEventListener('change', async (e) => {
      setError('');
      try {
        const f = e.target.files?.[0];
        if (!f) {
          logoB64 = null;
          if (elPreview) elPreview.style.display = 'none';
          if (elLogoUploadArea) elLogoUploadArea.classList.remove('has-image');
          return;
        }

        logoB64 = await toB64(f);
        if (elPreview) {
          elPreview.src = logoB64;
          elPreview.style.display = 'block';
        }
        if (elLogoUploadArea) {
          elLogoUploadArea.classList.add('has-image');
        }
      } catch (err) {
        setError('Erreur lors du chargement du logo: ' + (err?.message || String(err)));
      }
    });
  }

  // === BOUTONS NAVIGATION ===
  if (elBtnPrev) {
    elBtnPrev.addEventListener('click', () => {
      goToStep(currentStep - 1);
    });
  }

  if (elBtnNext) {
    elBtnNext.addEventListener('click', () => {
      goToStep(currentStep + 1);
    });
  }

  if (elBtnSkip) {
    elBtnSkip.addEventListener('click', async () => {
      try {
        await window.electronAPI.goMain();
      } catch (err) {
        setError('Erreur: ' + (err?.message || String(err)));
      }
    });
  }

  // === TERMINER ===
  if (elBtnFinish) {
    elBtnFinish.addEventListener('click', async () => {
      setError('');
      
      try {
        const modules = readModules();
        const smtp = readSmtp(modules);
        const pwd = ($('#pwd')?.value || '').trim();
        const shopName = ($('#shop-name')?.value || '').trim();

        if (pwd && pwd.length < 6) {
          setError('Le mot de passe doit contenir au moins 6 caractères');
          return;
        }

        // 1. Sauvegarder les modules, mot de passe et SMTP
        const payload = {
          new_password: pwd || null,
          modules,
          smtp,
        };

        const res = await window.electronAPI.submitOnboarding(payload);
        if (!res || !res.ok) {
          throw new Error(res?.error || "Impossible d'enregistrer la configuration");
        }

        // 2. Sauvegarder le branding (nom + logo) via brandingSet
        if (shopName || logoB64) {
          try {
            const brandingPayload = {};
            if (shopName) brandingPayload.name = shopName;
            if (logoB64) brandingPayload.logoDataUrl = logoB64;
            
            const brandingRes = await window.electronAPI.brandingSet(brandingPayload);
            if (!brandingRes?.ok) {
              console.warn('[onboarding] Branding non enregistré:', brandingRes?.error);
            }
          } catch (err) {
            console.warn('[onboarding] Erreur sauvegarde branding:', err);
            // Non bloquant
          }
        }

        await window.electronAPI.goMain();
      } catch (err) {
        setError(err?.message || String(err));
      }
    });
  }

  // === LECTURE DES DONNÉES ===
  function readModules() {
    const get = (id) => !!$('#' + id)?.checked;
    return {
      adherents:        get('m_adherents'),
      cotisations:      get('m_cotisations'),
      emails:           get('m_emails'),
      email:            get('m_emails'), // Alias
      stocks:           get('m_stocks'),
      inventaire:       get('m_inventaire'),
      fournisseurs:     get('m_fournisseurs'),
      receptions:       get('m_receptions'),
      ventes_exterieur: get('m_ventes_exterieur'),
      prospects:        get('m_prospects'),
      modes_paiement:   get('m_modes_paiement'),
      emailAdmin:       get('m_emailAdmin'),
      statistiques:     get('m_statistiques'),
    };
  }

  function readSmtp(modules) {
    if (!modules.emails && !modules.email) return null;
    
    return {
      host:   $('#smtp_host')?.value.trim() || null,
      port:   Number($('#smtp_port')?.value) || null,
      user:   $('#smtp_user')?.value.trim() || null,
      pass:   $('#smtp_pass')?.value || null,
      from:   $('#smtp_from')?.value.trim() || null,
      secure: $('#smtp_secure')?.value || 'starttls',
    };
  }

  // === PRÉ-REMPLISSAGE ===
  (async function init() {
    try {
      const r = await window.electronAPI.getOnboardingStatus();
      if (!r?.ok) return;
      
      const s = r.status || {};

      // Modules
      if (s.modules) {
        const m = s.modules || {};
        const set = (id, v) => {
          const el = $('#' + id);
          if (el) {
            el.checked = !!v;
            // Mettre à jour la classe de la card
            const card = el.closest('.module-card');
            if (card) {
              card.classList.toggle('selected', !!v);
            }
          }
        };
        
        set('m_adherents',        m.adherents);
        set('m_cotisations',      m.cotisations);
        set('m_emails',           m.emails || m.email);
        set('m_stocks',           m.stocks);
        set('m_inventaire',       m.inventaire);
        set('m_fournisseurs',     m.fournisseurs);
        set('m_receptions',       m.receptions);
        set('m_ventes_exterieur', m.ventes_exterieur);
        set('m_prospects',        m.prospects);
        set('m_modes_paiement',   m.modes_paiement);
        set('m_emailAdmin',       m.emailAdmin);
        set('m_statistiques',     m.statistiques);
      }

      // Logo
      if (s.logo_url && elPreview) {
        elPreview.src = s.logo_url;
        elPreview.style.display = 'block';
        if (elLogoUploadArea) {
          elLogoUploadArea.classList.add('has-image');
        }
      }

      // SMTP
      if (s.smtp) {
        const setVal = (id, val) => {
          const el = $(id);
          if (el && val) el.value = val;
        };
        setVal('#smtp_host', s.smtp.host);
        setVal('#smtp_port', s.smtp.port);
        setVal('#smtp_user', s.smtp.user);
        setVal('#smtp_from', s.smtp.from);
        setVal('#smtp_secure', s.smtp.secure);
        // Pas de pré-remplissage du mot de passe pour la sécurité
      }

      // Nom de l'épicerie (depuis branding)
      if (s.name || s.shop_name) {
        const nameInput = $('#shop-name');
        if (nameInput) nameInput.value = s.name || s.shop_name;
      }
    } catch (err) {
      console.warn('[onboarding] Erreur pré-remplissage:', err);
      // Non bloquant
    }
  })();

  // Initialiser sur step 1
  goToStep(1);
})();
