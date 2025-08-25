// src/main/handlers/ventes.js
const ventesDb = require('../db/ventes');
const fs = require('fs');
const path = require('path');

function isModuleActive(moduleName) {
  try {
    const configPath = path.join(__dirname, '..','..', '..', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return cfg.modules && cfg.modules[moduleName] === true;
  } catch (err) {
    console.error("Impossible de lire config.json :", err);
    return false;
  }
}

module.exports = function registerVentesHandlers(ipcMain) {
ipcMain.handle('enregistrer-vente', (_event, vente) => {
  const adherentsActive = isModuleActive('adherents');

  // Priorité au type de vente
  const saleType = (vente.sale_type === 'exterieur') ? 'exterieur' : 'adherent';
  if (saleType === 'exterieur') {
    vente.adherent_id = null; // aucune relation adhérent
    vente.cotisation = 0;     // jamais de cotisation
  } else if (!adherentsActive) {
    // fallback existant si module adhérents OFF
    vente.adherent_id = null;
    vente.cotisation = 0;
  }

  console.log('[PAYLOAD AVANT INSERT]', {
    saleType,
    adherent_id: vente.adherent_id,
    mode_paiement_id: vente.mode_paiement_id,
    frais_paiement: vente.frais_paiement,
    client_email: vente.client_email
  });

  return ventesDb.enregistrerVente(vente);
});



  // Historique des ventes
  ipcMain.handle('get-historique-ventes', (_event, filters) => {
    return ventesDb.getHistoriqueVentes(filters || {});
  });
  
  

  // Détails d’une vente
  ipcMain.handle('get-details-vente', (_event, venteId) => {
    return ventesDb.getDetailsVente(venteId);
  });
};
