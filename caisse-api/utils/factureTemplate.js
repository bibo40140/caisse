// utils/factureTemplate.js
// Génération du template HTML pour les factures

export function generateFactureHTML({
  numeroFacture,
  dateFacture,
  tenant,
  adherent,
  lignes,
  total,
  fraisPaiement,
  cotisation,
  acompte,
  modePaiement,
  logoUrl
}) {
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount || 0);
  };

  const sousTotal = (lignes || []).reduce((sum, l) => sum + (l.total || 0), 0);
  const totalFrais = Number(fraisPaiement || 0);
  const totalCotisation = Number(cotisation || 0);
  const totalAcompte = Number(acompte || 0);
  const totalGeneral = sousTotal + totalFrais + totalCotisation - totalAcompte;

  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="Logo" style="max-width: 150px; max-height: 80px;">` 
    : `<div style="font-size: 24px; font-weight: bold; color: #333;">${tenant?.company_name || 'Entreprise'}</div>`;

  const lignesHtml = (lignes || []).map(ligne => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${ligne.nom_produit || 'Produit'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${ligne.quantite || 0}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(ligne.prix_unitaire || 0)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${formatCurrency(ligne.total || 0)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facture ${numeroFacture}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 800px; margin: 20px auto; background-color: white; box-shadow: 0 0 20px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; color: white;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          ${logoHtml}
          <div style="margin-top: 20px; opacity: 0.9;">
            <div style="font-size: 14px;">${tenant?.company_name || ''}</div>
            <div style="font-size: 12px; margin-top: 5px;">${tenant?.adresse || ''}</div>
            <div style="font-size: 12px;">${tenant?.code_postal || ''} ${tenant?.ville || ''}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 32px; font-weight: bold;">FACTURE</div>
          <div style="font-size: 18px; margin-top: 10px; opacity: 0.9;">#${numeroFacture}</div>
          <div style="font-size: 14px; margin-top: 10px; opacity: 0.8;">Date: ${formatDate(dateFacture)}</div>
        </div>
      </div>
    </div>

    <!-- Client Info -->
    <div style="padding: 40px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
        <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Facturé à</div>
        <div style="font-size: 16px; font-weight: 600; color: #333;">${adherent?.nom || ''} ${adherent?.prenom || ''}</div>
        ${adherent?.adresse ? `<div style="font-size: 14px; color: #666; margin-top: 5px;">${adherent.adresse}</div>` : ''}
        ${adherent?.code_postal ? `<div style="font-size: 14px; color: #666;">${adherent.code_postal} ${adherent?.ville || ''}</div>` : ''}
        ${adherent?.email1 ? `<div style="font-size: 14px; color: #666; margin-top: 5px;">📧 ${adherent.email1}</div>` : ''}
        ${adherent?.telephone1 ? `<div style="font-size: 14px; color: #666; margin-top: 5px;">📞 ${adherent.telephone1}</div>` : ''}
      </div>

      <!-- Détails de la facture -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
        <thead>
          <tr style="background-color: #f8f9fa;">
            <th style="padding: 15px; text-align: left; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057;">Article</th>
            <th style="padding: 15px; text-align: center; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057; width: 80px;">Qté</th>
            <th style="padding: 15px; text-align: right; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057; width: 120px;">Prix Unit.</th>
            <th style="padding: 15px; text-align: right; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057; width: 120px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lignesHtml}
        </tbody>
      </table>

      <!-- Totaux -->
      <div style="border-top: 2px solid #dee2e6; padding-top: 20px;">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 30px;">
          <div style="width: 300px;">
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
              <span style="color: #666;">Sous-total</span>
              <span style="font-weight: 600;">${formatCurrency(sousTotal)}</span>
            </div>
            ${totalFrais > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
              <span style="color: #666;">Frais de paiement (${modePaiement || 'Carte'})</span>
              <span style="font-weight: 600;">${formatCurrency(totalFrais)}</span>
            </div>
            ` : ''}
            ${totalCotisation > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
              <span style="color: #666;">Cotisation adhérent</span>
              <span style="font-weight: 600;">${formatCurrency(totalCotisation)}</span>
            </div>
            ` : ''}
            ${totalAcompte > 0 ? `
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
              <span style="color: #666;">Acompte déduit</span>
              <span style="font-weight: 600; color: #28a745;">- ${formatCurrency(totalAcompte)}</span>
            </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; padding: 15px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 15px -15px -15px; padding: 15px; border-radius: 8px; color: white;">
              <span style="font-size: 18px; font-weight: 600;">TOTAL</span>
              <span style="font-size: 24px; font-weight: bold;">${formatCurrency(totalGeneral)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Paiement -->
      ${modePaiement ? `
      <div style="background-color: #e7f5e9; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745; margin-bottom: 30px;">
        <div style="display: flex; align-items: center;">
          <span style="font-size: 20px; margin-right: 10px;">✓</span>
          <span style="color: #155724; font-weight: 600;">Paiement reçu par ${modePaiement}</span>
        </div>
      </div>
      ` : ''}

      <!-- Footer -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Merci pour votre confiance !</p>
        <p style="margin: 5px 0;">Pour toute question concernant cette facture, n'hésitez pas à nous contacter.</p>
        ${tenant?.email ? `<p style="margin: 5px 0;">📧 ${tenant.email}</p>` : ''}
        ${tenant?.telephone ? `<p style="margin: 5px 0;">📞 ${tenant.telephone}</p>` : ''}
      </div>
    </div>

  </div>
</body>
</html>
  `;
}
