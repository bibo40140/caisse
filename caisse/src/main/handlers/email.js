// src/main/handlers/email.js
const { ipcMain } = require('electron');
const {
  envoyerFactureParEmail,
  envoyerEmailGenerique,
  getEmailSettings,
  setEmailSettings,
} = require('../db/email');

/**
 * Schéma attendu pour les settings (stockés par tenant dans tenant_settings, key="email"):
 * {
 *   provider: "gmail" | "smtp" | "disabled",
 *   // SMTP
 *   host?: string,
 *   port?: number,
 *   secure?: boolean,
 *   // Auth (gmail ou smtp)
 *   user?: string,
 *   pass?: string,
 *   // From
 *   from?: string
 * }
 */

function sanitizeSettings(s = {}) {
  const out = {};
  const provider = (s.provider || 'gmail').toLowerCase();
  out.provider = ['gmail', 'smtp', 'disabled'].includes(provider) ? provider : 'gmail';

  // Champs communs
  if (typeof s.user === 'string') out.user = s.user.trim();
  if (typeof s.pass === 'string') out.pass = s.pass; // ne pas trim (peut contenir espaces)

  if (typeof s.from === 'string') out.from = s.from.trim();

  // SMTP only
  if (out.provider === 'smtp') {
    if (typeof s.host === 'string') out.host = s.host.trim();
    if (s.port != null) out.port = Number(s.port);
    if (s.secure != null) out.secure = !!s.secure;
  }
  return out;
}

module.exports = function registerEmailHandlers() {
    console.log('[email] registering IPC handlers'); // ← tu dois le voir dans le terminal

  // === Envoi facture (inchangé, devient tenant-aware grâce à ../db/email) ===
  ipcMain.handle('envoyer-facture-email', async (_e, facture) => {
    try {
      await envoyerFactureParEmail(facture);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // === Envoi générique (inventaire, etc.) ===
  ipcMain.handle('send-inventory-recap-email', async (_e, payload) => {
    try {
      await envoyerEmailGenerique(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // === Lire la config e-mail du tenant courant ===
  ipcMain.handle('email:getSettings', async () => {
    try {
      const settings = getEmailSettings() || null;
      return { ok: true, settings };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // === Écrire la config e-mail du tenant courant ===
  ipcMain.handle('email:setSettings', async (_e, settings) => {
    try {
      const clean = sanitizeSettings(settings || {});
      // validations minimales
      if (clean.provider === 'smtp') {
        if (!clean.host) throw new Error('Hôte SMTP requis (email.host).');
        if (clean.port != null && (!Number.isFinite(clean.port) || clean.port <= 0)) {
          throw new Error('Port SMTP invalide.');
        }
      }
      if (clean.provider !== 'disabled') {
        // Si des identifiants sont nécessaires, on laisse passer sans forcer (serveur peut autoriser sans auth)
        // Mais si "user" est rempli, "pass" a du sens également.
        if (clean.user && typeof clean.pass !== 'string') {
          // pas bloquant : on autorise user sans pass si le serveur permet une auth différente
        }
      }

      const saved = setEmailSettings(clean);
      return { ok: true, settings: saved };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // === Test d’envoi: utilise la config actuelle du tenant ===
  ipcMain.handle('email:testSend', async (_e, { to, subject, text, html } = {}) => {
    try {
      if (!to) throw new Error('Adresse destinataire manquante.');
      // message simple si rien n’est fourni
      const msg = {
        to: String(to).trim(),
        subject: subject || '[Test] Configuration e-mail',
        text: text || 'Ceci est un e-mail de test pour vérifier la configuration.',
        html: html || '<p>Ceci est un <strong>e-mail de test</strong> pour vérifier la configuration.</p>',
      };
      await envoyerEmailGenerique(msg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
};
