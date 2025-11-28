// src/main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

/* -------------------------------------------------
   Allow-list des events écoutables côté renderer
-------------------------------------------------- */
const ALLOWED_EVENTS = new Set([
  // ✅ modules/config
  'config:changed',

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

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
});

/* -------------------------------------------------
   Espace "compat" electronEvents
-------------------------------------------------- */
contextBridge.exposeInMainWorld('electronEvents', { on, off, once });

/* -------------------------------------------------
   Helper dédié pour la config (évite les doublons)
-------------------------------------------------- */
function onConfigChanged(cb) {
  ipcRenderer.removeAllListeners('config:changed');
  const handler = (_e, cfg) => {
    try { cb(cfg); } catch {}
  };
  ipcRenderer.on('config:changed', handler);
  return () => ipcRenderer.removeListener('config:changed', handler);
}

/* -------------------------------------------------
   API principale (IPC invoke)
   ⚠️ Alignée avec les handlers déclarés dans main.js
-------------------------------------------------- */
contextBridge.exposeInMainWorld('electronAPI', {
  /* -------- Events (utilisés par le chip et config) -------- */
  on, off, once,
  onConfigChanged,

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  syncHydrateOnStartup: () => ipcRenderer.invoke('sync:hydrateOnStartup'),

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
  produitHasRemoteUuid: (produitId) => ipcRenderer.invoke('produit:has-remote-uuid', produitId),

  /* -------------- Mode de paiements ----------------------- */
  mp_getAll:   () => ipcRenderer.invoke('mp:getAll'),
  mp_create:   (p) => ipcRenderer.invoke('mp:create', p),
  mp_update:   (p) => ipcRenderer.invoke('mp:update', p),
  mp_remove:   (id) => ipcRenderer.invoke('mp:remove', id),

  /* -------------- Sync (full/refs/ops) ----------- */
  syncPushAll: () => ipcRenderer.invoke('sync:push_all'),
  syncPullAll: () => ipcRenderer.invoke('sync:pull_all'),
  syncPushBootstrapRefs: () => ipcRenderer.invoke('sync:pushBootstrapRefs'),
  // Alias compat
  syncPushProduits: () => ipcRenderer.invoke('sync:push_all'),
  syncPullProduits: () => ipcRenderer.invoke('sync:pull_all'),
  // Outils
  opsPushNow: () => ipcRenderer.invoke('ops:push-now'),
  opsPendingCount: () => ipcRenderer.invoke('ops:pending-count'),
  countPendingOps: () => ipcRenderer.invoke('ops:pending-count'),
  // retry failed ops (manual)
  retryFailedOps: (ids) => ipcRenderer.invoke('sync:retry_failed', ids),

  /* -------------- Logs & Diagnostic -------------- */
  getRecentLogs: (options) => ipcRenderer.invoke('logs:getRecent', options),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  exportDiagnostic: () => ipcRenderer.invoke('diagnostic:export'),

  /* -------------- Fournisseurs ------------------- */
  getFournisseurs: () => ipcRenderer.invoke('get-fournisseurs'),
  getFournisseurById: (id) => ipcRenderer.invoke('get-fournisseur-by-id', id),
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

  /* -------------- Email (par tenant) ------------- */
  emailGetSettings: () => ipcRenderer.invoke('email:getSettings'),
  emailSetSettings: (s) => ipcRenderer.invoke('email:setSettings', s),
  emailTestSend:   (p) => ipcRenderer.invoke('email:testSend', p),

  // --- Super admin: gestion ciblée d’un tenant ---
  adminGetTenantModules:   (tenantId)                 => ipcRenderer.invoke('admin:tenant:modules:get', tenantId),
  adminSetTenantModules:   (tenantId, modules)        => ipcRenderer.invoke('admin:tenant:modules:set', { tenantId, modules }),
  adminEmailGetSettings:   (tenantId)                 => ipcRenderer.invoke('admin:tenant:email:get', tenantId),
  adminEmailSetSettings:   (tenantId, settings)       => ipcRenderer.invoke('admin:tenant:email:set', { tenantId, settings }),
  adminEmailTestSend:      (tenantId, payload)        => ipcRenderer.invoke('admin:tenant:email:test', { tenantId, ...payload }),
  adminTenantDelete:       (tenantId, hard = false)   => ipcRenderer.invoke('admin:tenant:delete', { tenantId, hard }),

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
  getAdherents: (arg) => {
    if (typeof arg === 'boolean' || typeof arg === 'number') {
      return ipcRenderer.invoke('get-adherents', Number(arg));
    }
    return ipcRenderer.invoke('get-adherents', arg);
  },
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
  updateModules: (modules) => ipcRenderer.invoke('config:update-modules', modules), // compat
  getModules: () => ipcRenderer.invoke('get-modules'),
  setModules: (modules) => ipcRenderer.invoke('set-modules', modules),

  getVentesMargin: () => ipcRenderer.invoke('config:get-ventes-margin'),
  setVentesMargin: (value) => ipcRenderer.invoke('config:set-ventes-margin', value),

  /* -------------- Stock (batch) ------------------ */
  ajusterStockBulk: (payload) => ipcRenderer.invoke('stock:adjust-bulk', payload),

  /* -------------- Auth / infos ------------------- */
  getAuthInfo: () => ipcRenderer.invoke('auth:getInfo'),

  brandingGet: (tenantArg) => {
    const tenantId = (tenantArg && typeof tenantArg === 'object') ? tenantArg.tenantId : tenantArg;
    return ipcRenderer.invoke('branding:get', { tenantId });
  },
  brandingSet: async (payload) => {
    const p = payload || {};
    if (p.tenantId == null && typeof window !== 'undefined') {
      try {
        const info = await ipcRenderer.invoke('auth:getInfo');
        if (info?.tenant_id) p.tenantId = info.tenant_id;
      } catch {}
    }
    return ipcRenderer.invoke('branding:set', p);
  },

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
    start:     (payload) => ipcRenderer.invoke('inventory:start', payload),
    countAdd:  ({ sessionId, product_id, qty, user, device_id }) =>
      ipcRenderer.invoke('inventory:count-add', { sessionId, product_id, qty, user, device_id }),
    summary:   ({ sessionId }) => ipcRenderer.invoke('inventory:summary', { sessionId }),
    finalize:  ({ sessionId, user, email_to }) =>
      ipcRenderer.invoke('inventory:finalize', { sessionId, user, email_to }),
    listOpen:      () => ipcRenderer.invoke('inventory:list-open'),
    listSessions:  () => ipcRenderer.invoke('inventory:listSessions'),
    getSummary:    (sessionId) => ipcRenderer.invoke('inventory:getSummary', sessionId),
    closeAllOpen:  () => ipcRenderer.invoke('inventory:closeAllOpen'),
    markFinished:  ({ sessionId, device_id }) => ipcRenderer.invoke('inventory:markFinished', { sessionId, device_id }),
    getDeviceStatus: ({ sessionId }) => ipcRenderer.invoke('inventory:getDeviceStatus', { sessionId }),
  },

  produits: {
    list: () => ipcRenderer.invoke('produits:list'),
  },

  sendInventoryRecapEmail: (payload) => ipcRenderer.invoke('send-inventory-recap-email', payload),

  /* -------------- Device ID ---------------------- */
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),

  /* -------------- Auth / onboarding -------------- */
  authLogin: ({ email, password }) => ipcRenderer.invoke('auth:login', { email, password }),
  afterLoginRoute: () => ipcRenderer.invoke('auth:after-login-route'),
  getOnboardingStatus: () => ipcRenderer.invoke('onboarding:status'),
  submitOnboarding: (payload) => ipcRenderer.invoke('onboarding:submit', payload),
  goMain: () => ipcRenderer.invoke('app:go-main'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  ensureAuth: () => ipcRenderer.invoke('auth:ensure'),

  // 🔥 NOUVEAU : récupérer ce qu’on a sauvegardé (email + tenant) pour pré-remplir le login
  getSavedAuth: () => ipcRenderer.invoke('auth:getSavedAuth'),

  // Super admin (tenants root)
  adminRegisterTenant: (payload) => ipcRenderer.invoke('admin:registerTenant', payload),
  adminListTenants: () => ipcRenderer.invoke('admin:listTenants'),

  // --- Modules par tenant (API)
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
});
