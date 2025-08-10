const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Produits
  ajouterProduit: (produit) => ipcRenderer.invoke('ajouter-produit', produit),
  getProduits: () => ipcRenderer.invoke('get-produits'),
  modifierProduit: (produit) => ipcRenderer.invoke('modifier-produit', produit),
  supprimerProduit: (id) => ipcRenderer.invoke('supprimer-produit', id),
  supprimerEtRemplacerProduit: (n, id) => ipcRenderer.invoke('supprimer-et-remplacer-produit', n, id),
  rechercherProduitParNomEtFournisseur: (nom, fournisseurId) => ipcRenderer.invoke('rechercher-produit-par-nom-et-fournisseur', nom, fournisseurId),
  resoudreConflitProduit: (action, nouveau, existantId) => ipcRenderer.invoke('resoudre-conflit-produit', action, nouveau, existantId),


  // Fournisseurs
  getFournisseurs: () => ipcRenderer.invoke('get-fournisseurs'),
  modifierFournisseur: (f) => ipcRenderer.invoke('modifier-fournisseur', f),
  analyserImportFournisseurs: (filepath) => ipcRenderer.invoke("analyser-import-fournisseurs", filepath),
  validerImportFournisseurs: (liste) => ipcRenderer.invoke('valider-import-fournisseurs', liste),
  resoudreConflitFournisseur: (action, nouveau, existantId) => ipcRenderer.invoke('resoudre-conflit-fournisseur', action, nouveau, existantId),
  rechercherFournisseurParNom: (nom) => ipcRenderer.invoke('rechercher-fournisseur-par-nom', nom),

  // Catégories
  getCategories: () => ipcRenderer.invoke('get-categories'),
  ajouterCategorie: (nom) => ipcRenderer.invoke('ajouter-categorie', nom),
  modifierCategorie: (id, nom) => ipcRenderer.invoke('modifier-categorie', id, nom),
  supprimerCategorie: (id) => ipcRenderer.invoke('supprimer-categorie', id),

  // Unités
  getUnites: () => ipcRenderer.invoke('get-unites'),
  ajouterUnite: (nom) => ipcRenderer.invoke('ajouter-unite', nom),
  modifierUnite: (id, nom) => ipcRenderer.invoke('modifier-unite', id, nom),
  supprimerUnite: (id) => ipcRenderer.invoke('supprimer-unite', id),

  // Imports
  choisirFichier: () => ipcRenderer.invoke('choisir-fichier'),
  importerExcel: (type) => ipcRenderer.invoke('importer-excel', type),
  importerDepuisCSV: () => ipcRenderer.invoke('importer-csv'),
  importerDepuisCSVInteractif: (type) => ipcRenderer.invoke('importer-csv-interactif', type),
  analyserImportProduits: (filepath) => ipcRenderer.invoke('analyser-import-produits', filepath),
  validerImportProduits: (produits) => ipcRenderer.invoke('valider-import-produits', produits),

  // Ventes
  enregistrerVente: (data) => ipcRenderer.invoke('enregistrer-vente', data),
  envoyerFactureEmail: (facture) => ipcRenderer.invoke('envoyer-facture-email', facture),
  decrementerStock: (panier) => ipcRenderer.invoke('decrementer-stock', panier),
  getHistoriqueVentes: () => ipcRenderer.invoke('get-historique-ventes'),
  getFactureDetails: (id) => ipcRenderer.invoke('get-facture-details', id),
  getDetailVente: (id) => ipcRenderer.invoke('get-detail-vente', id),
  getStock: (id) => ipcRenderer.invoke('get-stock', id),


  // Adhérents
  getAdherents: (archive = 0) => ipcRenderer.invoke('get-adherents', archive),
  ajouterAdherent: (data) => ipcRenderer.invoke('ajouter-adherent', data),
  modifierAdherent: (data) => ipcRenderer.invoke('modifier-adherent', data),
  archiverAdherent: (id) => ipcRenderer.invoke('archiver-adherent', id),
  reactiverAdherent: (id) => ipcRenderer.invoke('reactiver-adherent', id),
  analyserImportAdherents: (filePath) => ipcRenderer.invoke('analyser-import-adherents', filePath),
  validerImportAdherents: (adherents) => ipcRenderer.invoke('valider-import-adherents', adherents),

  // Cotisations
  getCotisations: () => ipcRenderer.invoke('get-cotisations'),
  getCotisationsParAdherent: (id) => ipcRenderer.invoke('get-cotisations-par-adherent', id),
  ajouterCotisation: (c) => ipcRenderer.invoke('ajouter-cotisation', c),
  modifierCotisation: (c) => ipcRenderer.invoke('modifier-cotisation', c),
  supprimerCotisation: (id) => ipcRenderer.invoke('supprimer-cotisation', id),
    verifierCotisation: (adherentId) => ipcRenderer.invoke('verifier-cotisation', adherentId),


  // Réception
  enregistrerReception: (reception) => ipcRenderer.invoke('enregistrerReception', reception),
  getReceptions: () => ipcRenderer.invoke('getReceptions'),
  getReceptionDetails: (id) => ipcRenderer.invoke('getReceptionDetails', id),
});
