// src/main/db/email.js
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db'); // ← proxy tenant-aware (sélectionne la DB du tenant actif)

// ─────────────────────────────────────────────────────────
// Helpers config globale (fallback *optionnel*)
// ─────────────────────────────────────────────────────────
function readAppConfig() {
  try {
    const cfgPath = path.join(__dirname, '..', '..', 'config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch (_) {}
  return null;
}

// ─────────────────────────────────────────────────────────
// Lecture/écriture des réglages e-mail dans tenant_settings
// Clé: "email"  |  value_json: { provider, host, port, secure, user, pass, from }
// provider: "smtp" | "gmail" | "disabled" (par défaut: "gmail")
// ─────────────────────────────────────────────────────────
function getEmailSettings() {
  try {
    const row = db.prepare(`SELECT value_json FROM tenant_settings WHERE key = ?`).get('email');
    if (!row || !row.value_json) return null;
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function setEmailSettings(settings = {}) {
  const cleaned = { ...settings };
  // Normalisations douces
  if (cleaned.provider == null) cleaned.provider = 'gmail';
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
}

// ─────────────────────────────────────────────────────────
// Transport mail tenant-aware
// 1) Si tenant_settings.email existe → utiliser sa config
// 2) Sinon fallback “Gmail app password” (legacy) pour compat
// ─────────────────────────────────────────────────────────
function buildTransportFromSettings(s) {
  if (!s || s.provider === 'gmail') {
    // Si settings “gmail” ET user/pass fournis → on les utilise
    // Sinon fallback *legacy* (ancienne conf qui fonctionne déjà chez toi)
    const user = s?.user || 'epiceriecoopaz@gmail.com';
    const pass = s?.pass || 'vhkn hzel hasd lkeg';
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  if (s.provider === 'smtp') {
    const { host, port, secure, user, pass } = s;
    if (!host) throw new Error('SMTP host manquant (email.host).');
    // Auth facultative si le serveur l’autorise, mais on passe ce qu’on a
    const hasAuth = user && pass;
    return nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: !!secure, // true pour 465, false pour 587/STARTTLS
      auth: hasAuth ? { user, pass } : undefined,
    });
  }

  if (s.provider === 'disabled') {
    throw new Error('L’envoi d’e-mails est désactivé pour ce tenant.');
  }

  // Par défaut → gmail fallback
  const user = 'epiceriecoopaz@gmail.com';
  const pass = 'vhkn hzel hasd lkeg';
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

function getMailTransport() {
  const s = getEmailSettings();
  return buildTransportFromSettings(s);
}

function getDefaultFrom() {
  const s = getEmailSettings();
  // Priorité: réglage tenant → config.json → fallback gmail user
  const cfg = readAppConfig();
  const cfgFrom = cfg?.email?.from || cfg?.smtp?.from;
  const user = s?.user || 'epiceriecoopaz@gmail.com';
  return s?.from || cfgFrom || user;
}

// ─────────────────────────────────────────────────────────
// 📧 Envoi générique
// ─────────────────────────────────────────────────────────
async function envoyerEmailGenerique({ to, subject, text, html }) {
  if (!to) throw new Error('Destinataire manquant');
  const transporter = getMailTransport();
  await transporter.sendMail({
    from: getDefaultFrom(),
    to,
    subject: subject || '(Sans sujet)',
    text: text || undefined,
    html: html || undefined,
  });
}

// ─────────────────────────────────────────────────────────
// 📧 Envoi facture (tenant-aware; structure inchangée côté appelant)
// ─────────────────────────────────────────────────────────
function envoyerFactureParEmail({
  email, lignes, cotisation, acompte = 0, frais_paiement = 0, mode_paiement = '', total
}) {
  if (!email) {
    console.error('❌ Adresse email manquante pour l’envoi de la facture.');
    return;
  }

  const transporter = getMailTransport();

  const lignesHTML = (lignes || [])
    .map((p) => {
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
    })
    .join('');

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

  return transporter.sendMail({
    from: getDefaultFrom(),
    to: email,
    subject: "Votre facture",
    html,
  });
}

module.exports = {
  // transport
  getMailTransport,
  // envois
  envoyerEmailGenerique,
  envoyerFactureParEmail,
  // gestion réglages (tenant)
  getEmailSettings,
  setEmailSettings,
};
