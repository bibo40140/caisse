// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Produits
  ajouterProduit: (produit) => ipcRenderer.invoke('ajouter-produit', produit),
  getProduits: () => ipcRenderer.invoke('get-produits'),
  modifierProduit: (produit) => ipcRenderer.invoke('modifier-produit', produit),
  supprimerProduit: (id) => ipcRenderer.invoke('supprimer-produit', id),
  supprimerEtRemplacerProduit: (n, id) => ipcRenderer.invoke('supprimer-et-remplacer-produit', n, id),
  rechercherProduitParNomEtFournisseur: (nom, fournisseurId) => ipcRenderer.invoke('rechercher-produit-par-nom-et-fournisseur', nom, fournisseurId),
  resoudreConflitProduit: (action, nouveau, existantId) => ipcRenderer.invoke('resoudre-conflit-produit', action, nouveau, existantId),


// === Sync complet (NOUVEAU) ===
  syncPushAll: () => ipcRenderer.invoke('sync:push-all'),
  syncPullAll: () => ipcRenderer.invoke('sync:pull-all'),

  // Compatibilité avec l'ancien code (push/pull produits)
  // => on les redirige vers le push/pull complet
  syncPushProduits: () => ipcRenderer.invoke('sync:push-all'),
  syncPullProduits: () => ipcRenderer.invoke('sync:pull-all'),
  
    
  // --- Fournisseurs
  getFournisseurs: () => ipcRenderer.invoke('get-fournisseurs'),
  modifierFournisseur: (f) => ipcRenderer.invoke('modifier-fournisseur', f),
  analyserImportFournisseurs: (filepath) => ipcRenderer.invoke('analyser-import-fournisseurs', filepath),
  validerImportFournisseurs: (liste) => ipcRenderer.invoke('valider-import-fournisseurs', liste),
  resoudreConflitFournisseur: (action, nouveau, existantId) => ipcRenderer.invoke('resoudre-conflit-fournisseur', action, nouveau, existantId),
  rechercherFournisseurParNom: (nom) => ipcRenderer.invoke('rechercher-fournisseur-par-nom', nom),
  ajouterFournisseur: (f) => ipcRenderer.invoke('ajouter-fournisseur', f),

  // --- Catégories
  getCategoriesProduits: () => ipcRenderer.invoke('get-categories-produits'),
  ajouterCategorie: (nom) => ipcRenderer.invoke('ajouter-categorie', nom),
  modifierCategorie: (id, nom) => ipcRenderer.invoke('modifier-categorie', id, nom),
  supprimerCategorie: (id) => ipcRenderer.invoke('supprimer-categorie', id),
  
  // --- Familles ---
	getFamilies:        () => ipcRenderer.invoke('families:list'),
	createFamily:       (arg) => {const nom = (typeof arg === 'string') ? arg : (arg?.nom || ''); return ipcRenderer.invoke('families:create', nom);},
	renameFamily:       ({ id, nom }) => ipcRenderer.invoke('families:rename', { id: Number(id), nom }),
	deleteFamily:       (arg) => ipcRenderer.invoke('families:delete', Number(arg?.id ?? arg)),

  getCategoryTree: () => ipcRenderer.invoke('categories:tree'),
  getAllCategoriesDetailed: () => ipcRenderer.invoke('categories:all'),
  getCategoriesByFamily: (familleId) => ipcRenderer.invoke('categories:by-family', familleId),
  createCategory: (nom, familleId=null) => ipcRenderer.invoke('categories:create', { nom, familleId }),
  renameCategory: (id, nom) => ipcRenderer.invoke('categories:rename', { id, nom }),
  setCategoryFamily: (id, familleId=null) => ipcRenderer.invoke('categories:set-family', { id, familleId }),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
  
getCategories:      () => ipcRenderer.invoke('categories:all'), // renvoie au moins {id, nom, famille_id}
getCategoriesByFamily: (familleId) => ipcRenderer.invoke('categories:by-family', Number(familleId)),
createCategory:     ({ nom, famille_id, familleId }) =>
  ipcRenderer.invoke('categories:create', { nom, familleId: Number(famille_id ?? familleId) }),
updateCategory:     ({ id, nom }) =>
  ipcRenderer.invoke('categories:rename', { id: Number(id), nom }),
moveCategory:       ({ id, famille_id, familleId }) =>
  ipcRenderer.invoke('categories:set-family', { id: Number(id), familleId: Number(famille_id ?? familleId) }),
deleteCategory:     (arg) => ipcRenderer.invoke('categories:delete', Number(arg?.id ?? arg)),


  // --- Unités
  getUnites: () => ipcRenderer.invoke('get-unites'),
  ajouterUnite: (nom) => ipcRenderer.invoke('ajouter-unite', nom),
  modifierUnite: (id, nom) => ipcRenderer.invoke('modifier-unite', id, nom),
  supprimerUnite: (id) => ipcRenderer.invoke('supprimer-unite', id),

  // --- Imports
  choisirFichier: () => ipcRenderer.invoke('choisir-fichier'),
  importerExcel: (type) => ipcRenderer.invoke('importer-excel', type),
  importerDepuisCSV: () => ipcRenderer.invoke('importer-csv'),
  importerDepuisCSVInteractif: (type) => ipcRenderer.invoke('importer-csv-interactif', type),
  analyserImportProduits: (filepath) => ipcRenderer.invoke('analyser-import-produits', filepath),
  validerImportProduits: (produits) => ipcRenderer.invoke('valider-import-produits', produits),

  // --- Ventes
  enregistrerVente: (data) => ipcRenderer.invoke('enregistrer-vente', data),
  envoyerFactureEmail: (facture) => ipcRenderer.invoke('envoyer-facture-email', facture),
  decrementerStock: (produitId, quantite) => ipcRenderer.invoke('decrementer-stock', produitId, quantite),
  getFactureDetails: (id) => ipcRenderer.invoke('get-facture-details', id),
  getDetailVente: (id) => ipcRenderer.invoke('get-detail-vente', id),
  getStock: (id) => ipcRenderer.invoke('get-stock', id),
  getHistoriqueVentes: (filters) => ipcRenderer.invoke('get-historique-ventes', filters),
  getDetailsVente: (id) => ipcRenderer.invoke('get-details-vente', id),

  // --- Adhérents
  getAdherents: (archive = 0) => ipcRenderer.invoke('get-adherents', archive),
  ajouterAdherent: (data) => ipcRenderer.invoke('ajouter-adherent', data),
  modifierAdherent: (data) => ipcRenderer.invoke('modifier-adherent', data),
  archiverAdherent: (id) => ipcRenderer.invoke('archiver-adherent', id),
  reactiverAdherent: (id) => ipcRenderer.invoke('reactiver-adherent', id),
  analyserImportAdherents: (filePath) => ipcRenderer.invoke('analyser-import-adherents', filePath),
  validerImportAdherents: (adherents) => ipcRenderer.invoke('valider-import-adherents', adherents),

  // --- Cotisations
  getCotisations: () => ipcRenderer.invoke('get-cotisations'),
  getCotisationsParAdherent: (id) => ipcRenderer.invoke('get-cotisations-par-adherent', id),
  ajouterCotisation: (c) => ipcRenderer.invoke('ajouter-cotisation', c),
  modifierCotisation: (c) => ipcRenderer.invoke('modifier-cotisation', c),
  supprimerCotisation: (id) => ipcRenderer.invoke('supprimer-cotisation', id),
  verifierCotisation: (adherentId) => ipcRenderer.invoke('verifier-cotisation', adherentId),

  // --- Réceptions
  enregistrerReception: (reception) => ipcRenderer.invoke('enregistrer-reception', reception),
  getReceptions: () => ipcRenderer.invoke('get-receptions'),
  getReceptionDetails: (id) => ipcRenderer.invoke('get-details-reception', id),
  voirDetailsReception: (id) => ipcRenderer.invoke('get-details-reception', id),

  // --- Modes de paiement
  getModesPaiement: () => ipcRenderer.invoke('mp:getAll'),
  getModesPaiementAdmin: () => ipcRenderer.invoke('mp:getAllAdmin'),
  creerModePaiement: (payload) => ipcRenderer.invoke('mp:create', payload),
  majModePaiement: (payload) => ipcRenderer.invoke('mp:update', payload),
  supprimerModePaiement: (id) => ipcRenderer.invoke('mp:remove', id),

  // --- Config (modules + marge ventes extérieures)
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateModules: (modules) => ipcRenderer.invoke('config:update-modules', modules),

  // Handlers “legacy” (si encore utilisés dans l’app)
  getModules: () => ipcRenderer.invoke('get-modules'),
  setModules: (modules) => ipcRenderer.invoke('set-modules', modules),

  // ✅ NOUVEAU : marge ventes extérieures (%)
  getVentesMargin: () => ipcRenderer.invoke('config:get-ventes-margin'),
  setVentesMargin: (value) => ipcRenderer.invoke('config:set-ventes-margin', value),

  // --- Stock (batch)
  ajusterStockBulk: (payload) => ipcRenderer.invoke('stock:adjust-bulk', payload),
  
    // Prospects
  listProspects: (filters) => ipcRenderer.invoke('prospects:list', filters),
  createProspect: (p) => ipcRenderer.invoke('prospects:create', p),
  updateProspect: (p) => ipcRenderer.invoke('prospects:update', p),
  deleteProspect: (id) => ipcRenderer.invoke('prospects:delete', id),
  markProspectStatus: (id, status) => ipcRenderer.invoke('prospects:status', { id, status }),
convertProspectToAdherent: (idOrObj, adherentId) => {const id = (idOrObj && typeof idOrObj === 'object') ? idOrObj.id : idOrObj; return ipcRenderer.invoke('prospects:convert', { id, adherentId });}, 
 listProspectEmailTargets: (statuses) =>  ipcRenderer.invoke('prospects:list-email-targets', { statuses }),
  prospectsSendBulkEmail:  (payload)              => ipcRenderer.invoke('prospects:email-bulk', payload),
  listProspectInvitations: (filters)     => ipcRenderer.invoke('prospects:invitations', filters),
  prospectsListInvitations: (args)       => ipcRenderer.invoke('prospects:invitations', args),






  // --- Inventaire / produits
  produits: {
    list: () => ipcRenderer.invoke('produits:list'),
  },
});
