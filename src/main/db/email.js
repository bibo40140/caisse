// src/main/db/email.js
const nodemailer = require('nodemailer');
const fs = require('fs');

// 📧 Envoi de facture par email
function envoyerFactureParEmail({ email, lignes, cotisation, total }) {
	  console.log("📧 Envoi email à :", email); // Ajout temporaire pour debug

if (!email) {
  console.error("❌ Adresse email manquante pour l'envoi de la facture.");
  return;
}
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'epiceriecoopaz@gmail.com',
      pass: 'vhkn hzel hasd lkeg'
    }
  });

  let lignesHTML = lignes.map(p => `
    <tr>
      <td>${p.nom}</td>
      <td>${p.fournisseur_nom || ''}</td>
      <td>${p.unite || ''}</td>
      <td>${p.prix.toFixed(2)} €</td>
      <td>${p.quantite}</td>
      <td>${(p.prix * p.quantite).toFixed(2)} €</td>
    </tr>
  `).join('');

  if (cotisation && cotisation.length > 0) {
    lignesHTML += `
      <tr>
        <td>Cotisation</td>
        <td colspan="3"></td>
        <td>—</td>
        <td>${cotisation[0].prix.toFixed(2)} €</td>
      </tr>
    `;
  }

  const html = `
    <h2>Merci pour votre achat à Coop'az !</h2>
    <p>Voici le récapitulatif de votre facture :</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead>
        <tr>
          <th>Produit</th>
          <th>Fournisseur</th>
          <th>Unité</th>
          <th>PU</th>
          <th>Qté</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${lignesHTML}</tbody>
    </table>
    <p style="margin-top:20px;"><strong>Total : ${total.toFixed(2)} €</strong></p>
  `;

  return transporter.sendMail({
    from: 'epiceriecoopaz@gmail.com',
    to: email,
    subject: "Votre facture Coop'az",
    html
  });
}

module.exports = {
  envoyerFactureParEmail
};
