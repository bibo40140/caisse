// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');


/* -------------------------------------------------
   Allow-list des events écoutables côté renderer
-------------------------------------------------- */
const ALLOWED_EVENTS = new Set([
  // sync + chip
  'sync:state',          // { status, pending, lastError? }
  'ops:pushed',          // { count }
  'data:refreshed',      // { from }

  // optionnels
  'sync:error',
  'sync:pull_done',

  // inventaire (multi-postes)
  'inventory:count-updated',
  'inventory:session-changed',
]);

function on(channel, listener) {
  if (!ALLOWED_EVENTS.has(channel)) return () => {};
  const wrapped = (_event, data) => {
    try { listener(_event, data); } catch (_) {}
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}
function once(channel, listener) {
  if (!ALLOWED_EVENTS.has(channel)) return;
  ipcRenderer.once(channel, (_event, data) => {
    try { listener(_event, data); } catch (_) {}
  });
}
function off(channel, listener) {
  ipcRenderer.removeListener(channel, listener);
}

/* -------------------------------------------------
   Espace "compat" electronEvents
-------------------------------------------------- */
contextBridge.exposeInMainWorld('electronEvents', { on, off, once });

/* -------------------------------------------------
   API principale (IPC invoke)
   ⚠️ Alignée avec les handlers déclarés dans main.js
-------------------------------------------------- */
contextBridge.exposeInMainWorld('electronAPI', {
  /* -------- Events (utilisés par le chip) -------- */
  on, off, once,

 


  /* -------------- Produits ----------------------- */
  ajouterProduit: (produit) => ipcRenderer.invoke('ajouter-produit', produit),
  getProduits:    () => ipcRenderer.invoke('get-produits'),
  modifierProduit:(produit) => ipcRenderer.invoke('modifier-produit', produit),
  supprimerProduit:(id) => ipcRenderer.invoke('supprimer-produit', id),
  supprimerEtRemplacerProduit: (n, id) => ipcRenderer.invoke('supprimer-et-remplacer-produit', n, id),
  rechercherProduitParNomEtFournisseur: (nom, fournisseurId) =>
    ipcRenderer.invoke('rechercher-produit-par-nom-et-fournisseur', nom, fournisseurId),
  resoudreConflitProduit: (action, nouveau, existantId) =>
    ipcRenderer.invoke('resoudre-conflit-produit', action, nouveau, existantId),

  /* -------------- Sync (full/refs/ops) ----------- */
  syncPushAll: () => ipcRenderer.invoke('sync:push_all'),
  syncPullAll: () => ipcRenderer.invoke('sync:pull_all'),
  syncPushBootstrapRefs: () => ipcRenderer.invoke('sync:pushBootstrapRefs'),
  // anciens alias → on mappe vers les bons canaux pour éviter les erreurs
  syncPushProduits: () => ipcRenderer.invoke('sync:push_all'),
  syncPullProduits: () => ipcRenderer.invoke('sync:pull_all'),
  // Outils
  opsPushNow: () => ipcRenderer.invoke('ops:push-now'),
  opsPendingCount: () => ipcRenderer.invoke('ops:pending-count'),

  /* -------------- Fournisseurs ------------------- */
  getFournisseurs: () => ipcRenderer.invoke('get-fournisseurs'),
  modifierFournisseur: (f) => ipcRenderer.invoke('modifier-fournisseur', f),
  analyserImportFournisseurs: (filepath) => ipcRenderer.invoke('analyser-import-fournisseurs', filepath),
  validerImportFournisseurs: (liste) => ipcRenderer.invoke('valider-import-fournisseurs', liste),
  resoudreConflitFournisseur: (action, nouveau, existantId) =>
    ipcRenderer.invoke('resoudre-conflit-fournisseur', action, nouveau, existantId),
  rechercherFournisseurParNom: (nom) => ipcRenderer.invoke('rechercher-fournisseur-par-nom', nom),
  ajouterFournisseur: (f) => ipcRenderer.invoke('ajouter-fournisseur', f),

  /* -------------- Catégories & Familles ---------- */
  getFamilies:  () => ipcRenderer.invoke('families:list'),
  createFamily: (arg) => {
    const nom = (typeof arg === 'string') ? arg : (arg?.nom || '');
    return ipcRenderer.invoke('families:create', nom);
  },
  renameFamily: ({ id, nom }) => ipcRenderer.invoke('families:rename', { id: Number(id), nom }),
  deleteFamily: (arg) => ipcRenderer.invoke('families:delete', Number(arg?.id ?? arg)),

  getCategoryTree: () => ipcRenderer.invoke('categories:tree'),
  getAllCategoriesDetailed: () => ipcRenderer.invoke('categories:all'),
  getCategories: () => ipcRenderer.invoke('categories:all'),
  getCategoriesByFamily: (familleId) => ipcRenderer.invoke('categories:by-family', Number(familleId)),
  getCategoriesProduits: () => ipcRenderer.invoke('categories:all'),

  createCategory: ({ nom, famille_id, familleId }) =>
    ipcRenderer.invoke('categories:create', { nom, familleId: Number(famille_id ?? familleId) }),
  updateCategory: ({ id, nom }) =>
    ipcRenderer.invoke('categories:rename', { id: Number(id), nom }),
  moveCategory: ({ id, famille_id, familleId }) =>
    ipcRenderer.invoke('categories:set-family', { id: Number(id), familleId: Number(famille_id ?? familleId) }),
  deleteCategory: (arg) => ipcRenderer.invoke('categories:delete', Number(arg?.id ?? arg)),

  // anciens alias (si encore utilisés)
  ajouterCategorie: (nom) => ipcRenderer.invoke('ajouter-categorie', nom),
  modifierCategorie: (id, nom) => ipcRenderer.invoke('modifier-categorie', id, nom),
  supprimerCategorie: (id) => ipcRenderer.invoke('supprimer-categorie', id),

  /* -------------- Unités ------------------------- */
  getUnites: () => ipcRenderer.invoke('get-unites'),
  ajouterUnite: (nom) => ipcRenderer.invoke('ajouter-unite', nom),
  modifierUnite: (id, nom) => ipcRenderer.invoke('modifier-unite', id, nom),
  supprimerUnite: (id) => ipcRenderer.invoke('supprimer-unite', id),

  /* -------------- Imports ------------------------ */
  choisirFichier: () => ipcRenderer.invoke('choisir-fichier'),
  importerExcel: (type) => ipcRenderer.invoke('importer-excel', type),
  importerDepuisCSV: () => ipcRenderer.invoke('importer-csv'),
  importerDepuisCSVInteractif: (type) => ipcRenderer.invoke('importer-csv-interactif', type),
  analyserImportProduits: (filepath) => ipcRenderer.invoke('analyser-import-produits', filepath),
  validerImportProduits: (produits) => ipcRenderer.invoke('valider-import-produits', produits),

  // --- Email settings (par tenant) ---
emailGetSettings: () => ipcRenderer.invoke('email:getSettings'),
emailSetSettings: (s) => ipcRenderer.invoke('email:setSettings', s),
emailTestSend:   (p) => ipcRenderer.invoke('email:testSend', p),

  /* -------------- Ventes ------------------------- */
  enregistrerVente: (data) => ipcRenderer.invoke('enregistrer-vente', data),
  envoyerFactureEmail: (facture) => ipcRenderer.invoke('envoyer-facture-email', facture),
  decrementerStock: (produitId, quantite) => ipcRenderer.invoke('decrementer-stock', produitId, quantite),
  getFactureDetails: (id) => ipcRenderer.invoke('get-facture-details', id),
  getDetailVente: (id) => ipcRenderer.invoke('get-detail-vente', id),
  getStock: (id) => ipcRenderer.invoke('get-stock', id),
  getHistoriqueVentes: (filters) => ipcRenderer.invoke('get-historique-ventes', filters),
  getDetailsVente: (id) => ipcRenderer.invoke('get-details-vente', id),
  

  /* -------------- Adhérents ---------------------- */
  getAdherents: (archive = 0) => ipcRenderer.invoke('get-adherents', archive),
  ajouterAdherent: (data) => ipcRenderer.invoke('ajouter-adherent', data),
  modifierAdherent: (data) => ipcRenderer.invoke('modifier-adherent', data),
  archiverAdherent: (id) => ipcRenderer.invoke('archiver-adherent', id),
  reactiverAdherent: (id) => ipcRenderer.invoke('reactiver-adherent', id),
  analyserImportAdherents: (filePath) => ipcRenderer.invoke('analyser-import-adherents', filePath),
  validerImportAdherents: (adherents) => ipcRenderer.invoke('valider-import-adherents', adherents),

  /* -------------- Cotisations -------------------- */
  getCotisations: () => ipcRenderer.invoke('get-cotisations'),
  getCotisationsParAdherent: (id) => ipcRenderer.invoke('get-cotisations-par-adherent', id),
  ajouterCotisation: (adherentId, montant, date_paiement = null) =>
    ipcRenderer.invoke('ajouter-cotisation', adherentId, montant, date_paiement),
  modifierCotisation: (c) => ipcRenderer.invoke('modifier-cotisation', c),
  supprimerCotisation: (id) => ipcRenderer.invoke('supprimer-cotisation', id),
  verifierCotisation: (adherentId) => ipcRenderer.invoke('verifier-cotisation', adherentId),

  /* -------------- Réceptions --------------------- */
  enregistrerReception: (reception) => ipcRenderer.invoke('enregistrer-reception', reception),
  getReceptions: () => ipcRenderer.invoke('get-receptions'),
  getReceptionDetails: (id) => ipcRenderer.invoke('get-details-reception', id),
  voirDetailsReception: (id) => ipcRenderer.invoke('get-details-reception', id),

  /* -------------- Modes de paiement -------------- */
  getModesPaiement: () => ipcRenderer.invoke('mp:getAll'),
  getModesPaiementAdmin: () => ipcRenderer.invoke('mp:getAllAdmin'),
  creerModePaiement: (payload) => ipcRenderer.invoke('mp:create', payload),
  majModePaiement: (payload) => ipcRenderer.invoke('mp:update', payload),
  supprimerModePaiement: (id) => ipcRenderer.invoke('mp:remove', id),

  /* -------------- Config / Modules --------------- */
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateModules: (modules) => ipcRenderer.invoke('config:update-modules', modules),
  getModules: () => ipcRenderer.invoke('get-modules'),
  setModules: (modules) => ipcRenderer.invoke('set-modules', modules),

  getVentesMargin: () => ipcRenderer.invoke('config:get-ventes-margin'),
  setVentesMargin: (value) => ipcRenderer.invoke('config:set-ventes-margin', value),

  /* -------------- Stock (batch) ------------------ */
  ajusterStockBulk: (payload) => ipcRenderer.invoke('stock:adjust-bulk', payload),

  /* -------------- Prospects ---------------------- */
  listProspects: (filters) => ipcRenderer.invoke('prospects:list', filters),
  createProspect: (p) => ipcRenderer.invoke('prospects:create', p),
  updateProspect: (p) => ipcRenderer.invoke('prospects:update', p),
  deleteProspect: (id) => ipcRenderer.invoke('prospects:delete', id),
  markProspectStatus: (id, status) => ipcRenderer.invoke('prospects:status', { id, status }),
  convertProspectToAdherent: (idOrObj, adherentId) => {
    const id = (idOrObj && typeof idOrObj === 'object') ? idOrObj.id : idOrObj;
    return ipcRenderer.invoke('prospects:convert', { id, adherentId });
  },
  listProspectEmailTargets: (statuses) => ipcRenderer.invoke('prospects:list-email-targets', { statuses }),
  prospectsSendBulkEmail:  (payload) => ipcRenderer.invoke('prospects:email-bulk', payload),
  listProspectInvitations: (filters) => ipcRenderer.invoke('prospects:invitations', filters),
  prospectsListInvitations: (args) => ipcRenderer.invoke('prospects:invitations', args),

  /* -------------- Inventaire (IPC -> API) -------- */
  inventory: {
    start:     (payload)                         => ipcRenderer.invoke('inventory:start', payload),
    countAdd:  ({ sessionId, product_id, qty, user, device_id }) =>
      ipcRenderer.invoke('inventory:count-add', { sessionId, product_id, qty, user, device_id }),
    summary:   ({ sessionId })                   => ipcRenderer.invoke('inventory:summary', { sessionId }),
    finalize:  ({ sessionId, user, email_to })   =>
      ipcRenderer.invoke('inventory:finalize', { sessionId, user, email_to }),
  },

  /* -------------- Inventaire / produits ---------- */
  produits: {
    list: () => ipcRenderer.invoke('produits:list'),
  },

  sendInventoryRecapEmail: (payload) => ipcRenderer.invoke('send-inventory-recap-email', payload),

  /* -------------- Auth / onboarding -------------- */
  authLogin: ({ email, password }) => ipcRenderer.invoke('auth:login', { email, password }),
  afterLoginRoute: () => ipcRenderer.invoke('auth:after-login-route'),
  getOnboardingStatus: () => ipcRenderer.invoke('onboarding:status'),
  submitOnboarding: (payload) => ipcRenderer.invoke('onboarding:submit', payload),
  goMain: () => ipcRenderer.invoke('app:go-main'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Super admin (API protège ces routes)
  adminRegisterTenant: (payload) => ipcRenderer.invoke('admin:registerTenant', payload),
  adminListTenants: () => ipcRenderer.invoke('admin:listTenants'),

  // Infos d’auth pour afficher le bouton "Tenants (Super admin)"
  getAuthInfo: () => ipcRenderer.invoke('auth:getInfo'),

    // --- Modules par tenant (API) ---
  getTenantModules: () => ipcRenderer.invoke('tenant:modules:get'),
  setTenantModules: (modules) => ipcRenderer.invoke('tenant:modules:set', modules),

});

/* -------------- Paniers / Carts ------------------ */
contextBridge.exposeInMainWorld('carts', {
  save:   (payload)     => ipcRenderer.invoke('cart-save', payload),
  list:   (filter = {}) => ipcRenderer.invoke('cart-list', filter),
  load:   (id)          => ipcRenderer.invoke('cart-load', id),
  close:  (id)          => ipcRenderer.invoke('cart-close', id),
  delete: (id)          => ipcRenderer.invoke('cart-delete', id),
  remove: (id)          => ipcRenderer.invoke('cart-delete', id),

  // Alias inventaire
  inventory: {
    start:     (payload)                         => ipcRenderer.invoke('inventory:start', payload),
    countAdd:  ({ sessionId, product_id, qty, user, device_id }) =>
      ipcRenderer.invoke('inventory:count-add', { sessionId, product_id, qty, user, device_id }),
    summary:   ({ sessionId })                   => ipcRenderer.invoke('inventory:summary', { sessionId }),
    finalize:  ({ sessionId, user, email_to })   =>
      ipcRenderer.invoke('inventory:finalize', { sessionId, user, email_to }),
  },
});
