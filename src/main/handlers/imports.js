// src/main/handlers/imports.js
const { ipcMain, dialog } = require('electron');
const imports = require('../db/imports');
const importsDb = require('../db/imports');

ipcMain.handle('choisir-fichier', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });

  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('analyser-import-produits', (event, filepath) => {
  return imports.analyserImportProduits(filepath);
});

ipcMain.handle('analyser-import-fournisseurs', (event, filepath) => {
  return imports.analyserImportFournisseurs(filepath);
});

ipcMain.handle('resoudre-conflit-produit', async (event, action, nouveau, existantId) => {
  return importsDb.resoudreConflitProduit(action, nouveau, existantId);
});


ipcMain.handle('analyser-import-adherents', (event, filePath) => {
  return imports.analyserImportAdherents(filePath);
});


ipcMain.handle('valider-import-produits', (event, produits) => {
  return imports.validerImportProduits(produits);
});

ipcMain.handle('valider-import-fournisseurs', (event, fournisseurs) => {
  return imports.validerImportFournisseurs(fournisseurs);
});

ipcMain.handle('valider-import-adherents', (event, adherents) => {
  return imports.validerImportAdherents(adherents);
});


