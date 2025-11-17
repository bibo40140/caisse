// src/renderer/login.js
(function () {
  function $(id) { return document.getElementById(id); }

  const emailEl = $('email');
  const passEl  = $('password');
  const btn     = $('btn-login');
  const errEl   = $('err');

  function setError(msg) {
    if (errEl) errEl.textContent = msg || '';
  }

  async function preloadLastAuth() {
    try {
      // Optionnel : le main peut exposer getSavedAuth() pour préremplir l'email
      if (window.electronAPI && typeof window.electronAPI.getSavedAuth === 'function') {
        const saved = await window.electronAPI.getSavedAuth();
        if (saved && saved.email && emailEl) {
          emailEl.value = saved.email;
        }
      }
    } catch (_) {
      // Pas grave si ça plante, on ignore
    }
  }

  async function doLogin() {
    setError('');
    const email = (emailEl?.value || '').trim();
    const password = passEl?.value || '';

    if (!email || !password) {
      setError('Email et mot de passe requis.');
      return;
    }

    try {
      btn?.setAttribute('aria-busy', 'true');

      const r = await window.electronAPI.authLogin({ email, password });
      if (!r?.ok || !r?.token) {
        setError(r?.error || 'Identifiants invalides.');
        return;
      }

      // Décider où aller (onboarding ou app principale)
      const next = await window.electronAPI.afterLoginRoute();
      if (!next?.ok) {
        setError(next?.error || 'Redirection impossible.');
        return;
      }
      // Rien d’autre à faire ici : le main process ouvre la bonne fenêtre.
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      btn?.removeAttribute('aria-busy');
    }
  }

  // Events
  btn?.addEventListener('click', doLogin);
  passEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // Préremplir l'email si possible
  preloadLastAuth();
})();
