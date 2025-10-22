// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// —————————————————————————————————————————————
// Bus d’événements (main -> renderer)
// —————————————————————————————————————————————
contextBridge.exposeInMainWorld('electronEvents', {
  on: (channel, listener) => {
    const allowed = new Set(['ops:pushed', 'data:refreshed']);
    if (!allowed.has(channel)) return;
    ipcRenderer.on(channel, listener);
  },
  off: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
  once: (channel, listener) => {
    const allowed = new Set(['ops:pushed', 'data:refreshed']);
    if (!allowed.has(channel)) return;
    ipcRenderer.once(channel, listener);
  }
});

// Petit helper: invoke sûr (remonte proprement les erreurs)
async function safeInvoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    throw new Error(e?.message || String(e) || 'IPC invoke failed');
  }
}

// —————————————————————————————————————————————
// API principale
// —————————————————————————————————————————————
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Produits
  ajouterProduit: (produit) => safeInvoke('ajouter-produit', produit),
  getProduits:    () => safeInvoke('get-produits'),
  modifierProduit:(produit) => safeInvoke('modifier-produit', produit),
  supprimerProduit:(id) => safeInvoke('supprimer-produit', id),
  supprimerEtRemplacerProduit: (n, id) => safeInvoke('supprimer-et-remplacer-produit', n, id),
  rechercherProduitParNomEtFournisseur: (nom, fournisseurId) =>
    safeInvoke('rechercher-produit-par-nom-et-fournisseur', nom, fournisseurId),
  resoudreConflitProduit: (action, nouveau, existantId) =>
    safeInvoke('resoudre-conflit-produit', action, nouveau, existantId),

  // === Sync complet ===
  syncPushAll: () => safeInvoke('sync:push_all'),
  syncPullAll: () => safeInvoke('sync:pull_all'),
  syncPushBootstrapRefs: () => safeInvoke('sync:pushBootstrapRefs'),

  // Compat ancien code (redirigé vers full sync)
  syncPushProduits: () => safeInvoke('sync:push-all'),
  syncPullProduits: () => safeInvoke('sync:pull-all'),

  // ——— Ajouts utiles sync (push manuel + compteur d’ops) ———
  opsPushNow: () => safeInvoke('ops:push-now'),
  opsPendingCount: () => safeInvoke('ops:pending-count'),

  // --- Fournisseurs
  getFournisseurs: () => safeInvoke('get-fournisseurs'),
  modifierFournisseur: (f) => safeInvoke('modifier-fournisseur', f),
  analyserImportFournisseurs: (filepath) => safeInvoke('analyser-import-fournisseurs', filepath),
  validerImportFournisseurs: (liste) => safeInvoke('valider-import-fournisseurs', liste),
  resoudreConflitFournisseur: (action, nouveau, existantId) =>
    safeInvoke('resoudre-conflit-fournisseur', action, nouveau, existantId),
  rechercherFournisseurParNom: (nom) => safeInvoke('rechercher-fournisseur-par-nom', nom),
  ajouterFournisseur: (f) => safeInvoke('ajouter-fournisseur', f),

  // --- Catégories & Familles
  getFamilies:  () => safeInvoke('families:list'),
  createFamily: (arg) => {
    const nom = (typeof arg === 'string') ? arg : (arg?.nom || '');
    return safeInvoke('families:create', nom);
  },
  renameFamily: ({ id, nom }) => safeInvoke('families:rename', { id: Number(id), nom }),
  deleteFamily: (arg) => safeInvoke('families:delete', Number(arg?.id ?? arg)),

  // Catégories (API unifiée compatible avec parametres.js)
  getCategoryTree: () => safeInvoke('categories:tree'),
  getAllCategoriesDetailed: () => safeInvoke('categories:all'),
  getCategories: () => safeInvoke('categories:all'),
  getCategoriesByFamily: (familleId) => safeInvoke('categories:by-family', Number(familleId)),
  createCategory: ({ nom, famille_id, familleId }) =>
    safeInvoke('categories:create', { nom, familleId: Number(famille_id ?? familleId) }),
  updateCategory: ({ id, nom }) =>
    safeInvoke('categories:rename', { id: Number(id), nom }),
  moveCategory: ({ id, famille_id, familleId }) =>
    safeInvoke('categories:set-family', { id: Number(id), familleId: Number(famille_id ?? familleId) }),
  deleteCategory: (arg) => safeInvoke('categories:delete', Number(arg?.id ?? arg)),
  getCategoriesProduits: () => safeInvoke('categories:all'),

  // Anciens alias (si encore utilisés)
  ajouterCategorie: (nom) => safeInvoke('ajouter-categorie', nom),
  modifierCategorie: (id, nom) => safeInvoke('modifier-categorie', id, nom),
  supprimerCategorie: (id) => safeInvoke('supprimer-categorie', id),

  // --- Unités
  getUnites: () => safeInvoke('get-unites'),
  ajouterUnite: (nom) => safeInvoke('ajouter-unite', nom),
  modifierUnite: (id, nom) => safeInvoke('modifier-unite', id, nom),
  supprimerUnite: (id) => safeInvoke('supprimer-unite', id),

  // --- Imports
  choisirFichier: () => safeInvoke('choisir-fichier'),
  importerExcel: (type) => safeInvoke('importer-excel', type),
  importerDepuisCSV: () => safeInvoke('importer-csv'),
  importerDepuisCSVInteractif: (type) => safeInvoke('importer-csv-interactif', type),
  analyserImportProduits: (filepath) => safeInvoke('analyser-import-produits', filepath),
  validerImportProduits: (produits) => safeInvoke('valider-import-produits', produits),

  // --- Ventes
  enregistrerVente: (data) => safeInvoke('enregistrer-vente', data),
  envoyerFactureEmail: (facture) => safeInvoke('envoyer-facture-email', facture),
  decrementerStock: (produitId, quantite) => safeInvoke('decrementer-stock', produitId, quantite),
  getFactureDetails: (id) => safeInvoke('get-facture-details', id),
  getDetailVente: (id) => safeInvoke('get-detail-vente', id),
  getStock: (id) => safeInvoke('get-stock', id),
  getHistoriqueVentes: (filters) => safeInvoke('get-historique-ventes', filters),
  getDetailsVente: (id) => safeInvoke('get-details-vente', id),

  // --- Adhérents
  getAdherents: (archive = 0) => safeInvoke('get-adherents', archive),
  ajouterAdherent: (data) => safeInvoke('ajouter-adherent', data),
  modifierAdherent: (data) => safeInvoke('modifier-adherent', data),
  archiverAdherent: (id) => safeInvoke('archiver-adherent', id),
  reactiverAdherent: (id) => safeInvoke('reactiver-adherent', id),
  analyserImportAdherents: (filePath) => safeInvoke('analyser-import-adherents', filePath),
  validerImportAdherents: (adherents) => safeInvoke('valider-import-adherents', adherents),

  // --- Cotisations
  getCotisations: () => safeInvoke('get-cotisations'),
  getCotisationsParAdherent: (id) => safeInvoke('get-cotisations-par-adherent', id),
  ajouterCotisation: (adherentId, montant, date_paiement = null) =>
    safeInvoke('ajouter-cotisation', adherentId, montant, date_paiement),
  modifierCotisation: (c) => safeInvoke('modifier-cotisation', c),
  supprimerCotisation: (id) => safeInvoke('supprimer-cotisation', id),
  verifierCotisation: (adherentId) => safeInvoke('verifier-cotisation', adherentId),

  // --- Réceptions
  // IMPORTANT : renvoie un NOMBRE (id) attendu par le renderer
  enregistrerReception: (payload) => safeInvoke('receptions:create', payload),
  getReceptions: () => safeInvoke('get-receptions'),
  getReceptionDetails: (id) => safeInvoke('get-details-reception', id),
  voirDetailsReception: (id) => safeInvoke('get-details-reception', id),

  // --- Modes de paiement
  getModesPaiement: () => safeInvoke('mp:getAll'),
  getModesPaiementAdmin: () => safeInvoke('mp:getAllAdmin'),
  creerModePaiement: (payload) => safeInvoke('mp:create', payload),
  majModePaiement: (payload) => safeInvoke('mp:update', payload),
  supprimerModePaiement: (id) => safeInvoke('mp:remove', id),

  // --- Config (modules + marge ventes extérieures)
  getConfig: () => safeInvoke('config:get'),
  updateModules: (modules) => safeInvoke('config:update-modules', modules),

  // Handlers “legacy”
  getModules: () => safeInvoke('get-modules'),
  setModules: (modules) => safeInvoke('set-modules', modules),

  // Marge ventes extérieures (%)
  getVentesMargin: () => safeInvoke('config:get-ventes-margin'),
  setVentesMargin: (value) => safeInvoke('config:set-ventes-margin', value),

  // --- Stock (batch)
  ajusterStockBulk: (payload) => safeInvoke('stock:adjust-bulk', payload),

  // --- Prospects
  listProspects: (filters) => safeInvoke('prospects:list', filters),
  createProspect: (p) => safeInvoke('prospects:create', p),
  updateProspect: (p) => safeInvoke('prospects:update', p),
  deleteProspect: (id) => safeInvoke('prospects:delete', id),
  markProspectStatus: (id, status) => safeInvoke('prospects:status', { id, status }),
  convertProspectToAdherent: (idOrObj, adherentId) => {
    const id = (idOrObj && typeof idOrObj === 'object') ? idOrObj.id : idOrObj;
    return safeInvoke('prospects:convert', { id, adherentId });
  },
  listProspectEmailTargets: (statuses) => safeInvoke('prospects:list-email-targets', { statuses }),
  prospectsSendBulkEmail:  (payload) => safeInvoke('prospects:email-bulk', payload),
  listProspectInvitations: (filters) => safeInvoke('prospects:invitations', filters),
  prospectsListInvitations: (args) => safeInvoke('prospects:invitations', args),

  // --- Inventaire / produits (espace de noms)
  produits: {
    list: () => safeInvoke('produits:list'),
  },
});

// --- Paniers / Carts ---
contextBridge.exposeInMainWorld('carts', {
  save:   (payload)       => safeInvoke('cart-save', payload),
  list:   (filter = {})   => safeInvoke('cart-list', filter),
  load:   (id)            => safeInvoke('cart-load', id),
  close:  (id)            => safeInvoke('cart-close', id),
  delete: (id)            => safeInvoke('cart-delete', id),
  remove: (id)            => safeInvoke('cart-delete', id),
});
