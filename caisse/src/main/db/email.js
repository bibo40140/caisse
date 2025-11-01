// src/main/db/email.js
const nodemailer = require('nodemailer');
const db = require('./db'); // proxy tenant-aware (DB locale du tenant actif)

// ─────────────────────────────────────────────────────────
// Helpers: lecture des settings depuis tenant_settings
// ─────────────────────────────────────────────────────────
function getJsonSetting(key) {
  const row = db.prepare(`SELECT value_json FROM tenant_settings WHERE key = ?`).get(String(key));
  if (!row || !row.value_json) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

function getTenantModules() {
  // attendu: { emails: true/false, ... }
  return getJsonSetting('modules') || {};
}

function getEmailSettings() {
  // attendu: { provider: "smtp"|"gmail"|"disabled", host?, port?, secure?, user?, pass?, from? }
  return getJsonSetting('email');
}

// ─────────────────────────────────────────────────────────
// Garde: module emails activé + config présente
// ─────────────────────────────────────────────────────────
function assertEmailsEnabled() {
  const modules = getTenantModules();
  if (!modules || modules.emails !== true) {
    const e = new Error('Module Emails désactivé pour ce tenant.');
    e.code = 'EMAILS_DISABLED';
    throw e;
  }
}

function assertSettingsConfigured(s) {
  if (!s) {
    const e = new Error('Configuration e-mail manquante pour ce tenant.');
    e.code = 'EMAILS_NOT_CONFIGURED';
    throw e;
  }
  if (s.provider === 'disabled') {
    const e = new Error('L’envoi d’e-mails est désactivé pour ce tenant.');
    e.code = 'EMAILS_PROVIDER_DISABLED';
    throw e;
  }
}

// ─────────────────────────────────────────────────────────
// Construction du transport — AUCUN fallback en dur
// ─────────────────────────────────────────────────────────
function buildTransportFromSettings(s) {
  assertSettingsConfigured(s);

  if (s.provider === 'gmail') {
    // Requiert user+pass préconfigurés dans tenant_settings → sinon on refuse
    if (!s.user || !s.pass) {
      const e = new Error("Compte Gmail/app password manquant dans la configuration e-mail du tenant.");
      e.code = 'EMAILS_GMAIL_MISSING_CREDS';
      throw e;
    }
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: s.user, pass: s.pass },
    });
  }

  if (s.provider === 'smtp') {
    if (!s.host) {
      const e = new Error('SMTP host manquant (email.host).');
      e.code = 'EMAILS_SMTP_HOST_MISSING';
      throw e;
    }
    const transport = {
      host: s.host,
      port: Number.isFinite(s.port) ? Number(s.port) : 587,
      secure: !!s.secure, // 465 = true ; 587 STARTTLS = false
    };
    if (s.user && s.pass) {
      transport.auth = { user: s.user, pass: s.pass };
    }
    return nodemailer.createTransport(transport);
  }

  // Si provider inconnu → refuse
  const e = new Error('Provider e-mail invalide ou non supporté.');
  e.code = 'EMAILS_PROVIDER_INVALID';
  throw e;
}

function getMailTransport() {
  const s = getEmailSettings();
  return buildTransportFromSettings(s);
}

function getDefaultFrom() {
  const s = getEmailSettings();
  // Priorité: from explicit → sinon user (gmail/smtp)
  if (s?.from) return String(s.from).trim();
  if (s?.user) return String(s.user).trim();
  const e = new Error('Adresse "from" introuvable (renseignez email.from ou email.user).');
  e.code = 'EMAILS_FROM_MISSING';
  throw e;
}

// ─────────────────────────────────────────────────────────
// 📧 Envoi générique (respect module + config)
// ─────────────────────────────────────────────────────────
async function envoyerEmailGenerique({ to, subject, text, html }) {
  assertEmailsEnabled();
  if (!to) throw new Error('Destinataire manquant');

  const transporter = getMailTransport();
  await transporter.sendMail({
    from: getDefaultFrom(),
    to: String(to).trim(),
    subject: subject || '(Sans sujet)',
    text: text || undefined,
    html: html || undefined,
  });
}

// ─────────────────────────────────────────────────────────
// 📧 Envoi facture (respect module + config)
// ─────────────────────────────────────────────────────────
async function envoyerFactureParEmail({
  email, lignes, cotisation, acompte = 0, frais_paiement = 0, mode_paiement = '', total
}) {
  assertEmailsEnabled();
  if (!email) throw new Error('Adresse email manquante pour l’envoi de la facture');

  const transporter = getMailTransport();

  const lignesHTML = (lignes || []).map((p) => {
    const prix = Number(p.prix || 0);
    const puOrig = Number(p.prix_unitaire ?? p.prix);
    const remise = Number(p.remise_percent ?? 0);
    const qte = Number(p.quantite || 0);
    const totalLigne = prix * qte;
    return `
      <tr>
        <td>${p.nom || p.produit_nom || ''}</td>
        <td>${p.fournisseur_nom || ''}</td>
        <td>${p.unite || ''}</td>
        <td>${puOrig.toFixed(2)} €</td>
        <td>${remise ? remise.toFixed(2) + ' %' : '—'}</td>
        <td>${prix.toFixed(2)} €</td>
        <td>${qte}</td>
        <td>${totalLigne.toFixed(2)} €</td>
      </tr>`;
  }).join('');

  const cotisationHTML =
    cotisation && cotisation.length > 0
      ? `
      <tr>
        <td><em>Cotisation</em></td>
        <td colspan="6"></td>
        <td>${Number(cotisation[0].prix || 0).toFixed(2)} €</td>
      </tr>`
      : '';

  const acompteHTML =
    Number(acompte) > 0
      ? `
      <tr>
        <td><strong>Acompte utilisé</strong></td>
        <td colspan="6"></td>
        <td>−${Number(acompte).toFixed(2)} €</td>
      </tr>`
      : '';

  const fraisHTML =
    Number(frais_paiement) > 0
      ? `
      <tr>
        <td>Frais de paiement ${mode_paiement ? '(' + mode_paiement + ')' : ''}</td>
        <td colspan="6"></td>
        <td>${Number(frais_paiement).toFixed(2)} €</td>
      </tr>`
      : '';

  const html = `
    <h2>Merci pour votre achat !</h2>
    <p>Voici le récapitulatif de votre facture :</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;min-width:700px">
      <thead>
        <tr>
          <th>Produit</th>
          <th>Fournisseur</th>
          <th>Unité</th>
          <th>PU (avant remise)</th>
          <th>Remise</th>
          <th>PU appliqué</th>
          <th>Qté</th>
          <th>Total ligne</th>
        </tr>
      </thead>
      <tbody>
        ${lignesHTML}
        ${cotisationHTML}
        ${acompteHTML}
        ${fraisHTML}
        <tr>
          <td colspan="7" style="text-align:right;"><strong>Total :</strong></td>
          <td><strong>${Number(total || 0).toFixed(2)} €</strong></td>
        </tr>
      </tbody>
    </table>
  `;

  await transporter.sendMail({
    from: getDefaultFrom(),
    to: String(email).trim(),
    subject: 'Votre facture',
    html,
  });
}

module.exports = {
  getMailTransport,
  envoyerEmailGenerique,
  envoyerFactureParEmail,
  getEmailSettings,
  setEmailSettings: (s) => {
    // On conserve ta fonction, mais on force le provider par défaut à "disabled"
    const cleaned = { ...(s || {}) };
    if (!cleaned.provider) cleaned.provider = 'disabled';
    if (cleaned.port != null) cleaned.port = Number(cleaned.port);
    if (cleaned.secure != null) cleaned.secure = !!cleaned.secure;

    const value_json = JSON.stringify(cleaned);
    db.prepare(`
      INSERT INTO tenant_settings (key, value_json, updated_at)
      VALUES ('email', ?, datetime('now','localtime'))
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(value_json);

    return cleaned;
  },
  // exposé modules si besoin ailleurs
  getTenantModules,
};
