// src/renderer/renderer.js
(() => {
  // --- Wrappers Caisse ---
  window.renderCaisse     = (...a) => window.PageCaisse.renderCaisse(...a);
  window.validerVente     = (...a) => window.PageCaisse.validerVente(...a);

  // --- Wrappers Produits ---
  window.renderFormulaireProduit = (...a) => window.PageProduits.renderFormulaireProduit(...a);
  window.chargerProduits         = (...a) => window.PageProduits.chargerProduits(...a);

  // --- Wrappers Adhérents ---
  window.renderGestionAdherents     = (...a) => window.PageAdherents.renderGestionAdherents(...a);
  window.showFormModalAdherent      = (...a) => window.PageAdherents.showFormModalAdherent(...a);
  window.renderImportAdherents      = (...a) => window.PageAdherents.renderImportAdherents(...a);
  window.renderCotisations          = (...a) => window.PageAdherents.renderCotisations(...a);
  window.verifierCotisationAdherent = (...a) => window.PageAdherents.verifierCotisationAdherent(...a);

  // --- Wrappers Fournisseurs ---
  window.chargerFournisseurs       = (...a) => window.PageFournisseurs.chargerFournisseurs(...a);
  window.ajouterFournisseur        = (...a) => window.PageFournisseurs.ajouterFournisseur(...a);
  window.modifierFournisseur       = (...a) => window.PageFournisseurs.modifierFournisseur(...a);
  window.renderImportFournisseurs  = (...a) => window.PageFournisseurs.renderImportFournisseurs(...a);

  // --- Wrappers Réceptions ---
  window.renderReception  = (...a) => window.PageReceptions.renderReception(...a);
  window.renderReceptions = (...a) => window.PageReceptions.renderReceptions(...a);

  // --- Wrappers Inventaire ---
    window.renderInventaire = (...a) => window.PageInventaire.renderInventaire(...a);
  
  // --- Wrappers Paramètres ---
  window.renderParametresHome        = (...a) => window.PageParams.renderParametresHome?.(...a);
  window.renderImportExcel           = (...a) => window.PageParams.renderImportExcel(...a);
  window.importerExcel               = (...a) => window.PageParams.importerExcel(...a);
  window.renderImportProduits        = (...a) => window.PageParams.renderImportProduits(...a);
  window.renderHistoriqueFactures    = (...a) => window.PageParams.renderHistoriqueFactures?.(...a);
  window.renderGestionCategories     = (...a) => window.PageParams.renderGestionCategories(...a);
  window.renderGestionUnites         = (...a) => window.PageParams.renderGestionUnites(...a);
  window.renderGestionModesPaiement  = (...a) => window.PageParams.renderGestionModesPaiement(...a);
  window.renderActivationModules     = (...a) => window.PageParams.renderActivationModules(...a);
  



})();
