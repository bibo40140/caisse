// src/main/db/email.js
const nodemailer = require('nodemailer');

// 👉 Nouveau: on expose un helper pour créer le transporteur
function getMailTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'epiceriecoopaz@gmail.com',
      pass: 'vhkn hzel hasd lkeg'
    }
  });
}

// 📧 Envoi de facture par email
function envoyerFactureParEmail({ email, lignes, cotisation, acompte = 0, frais_paiement = 0, mode_paiement = '', total }) {
  console.log("📧 Envoi email à :", email);
  if (!email) {
    console.error("❌ Adresse email manquante pour l'envoi de la facture.");
    return;
  }

  // ⚙️ Utilise le même transporteur
  const transporter = getMailTransport();

  const lignesHTML = (lignes || []).map(p => {
    const prix   = Number(p.prix || 0);
    const puOrig = Number(p.prix_unitaire ?? p.prix);
    const remise = Number(p.remise_percent ?? 0);
    const qte    = Number(p.quantite || 0);
    const totalLigne = prix * qte;

    return `
      <tr>
        <td>${p.nom || p.produit_nom || ''}</td>
        <td>${p.fournisseur_nom || ''}</td>
        <td>${p.unite || ''}</td>
        <td>${puOrig.toFixed(2)} €</td>
        <td>${remise ? (remise.toFixed(2) + ' %') : '—'}</td>
        <td>${prix.toFixed(2)} €</td>
        <td>${qte}</td>
        <td>${totalLigne.toFixed(2)} €</td>
      </tr>
    `;
  }).join('');

  const cotisationHTML = (cotisation && cotisation.length > 0)
    ? `
      <tr>
        <td><em>Cotisation</em></td>
        <td colspan="6"></td>
        <td>${Number(cotisation[0].prix || 0).toFixed(2)} €</td>
      </tr>
    `
    : '';

  const acompteHTML = (Number(acompte) > 0)
    ? `
      <tr>
        <td><strong>Acompte utilisé</strong></td>
        <td colspan="6"></td>
        <td>−${Number(acompte).toFixed(2)} €</td>
      </tr>
    `
    : '';

  const fraisHTML = (Number(frais_paiement) > 0)
    ? `
      <tr>
        <td>Frais de paiement ${mode_paiement ? '(' + mode_paiement + ')' : ''}</td>
        <td colspan="6"></td>
        <td>${Number(frais_paiement).toFixed(2)} €</td>
      </tr>
    `
    : '';

  const html = `
    <h2>Merci pour votre achat à Coop'az !</h2>
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
    from: 'epiceriecoopaz@gmail.com',
    to: email,
    subject: "Votre facture Coop'az",
    html
  });
}

module.exports = { envoyerFactureParEmail, getMailTransport };
