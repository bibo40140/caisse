// src/main/handlers/categories.js
const { ipcMain } = require('electron');
const cat = require('../db/categories');

function registerCategoryHandlers() {
  // ---- familles
  ipcMain.handle('families:list', () => cat.getFamilies());
  ipcMain.handle('families:create', (_e, nom) => cat.createFamily(nom));
  ipcMain.handle('families:rename', (_e, { id, nom }) => cat.renameFamily(id, nom));
  ipcMain.handle('families:delete', (_e, id) => cat.deleteFamily(id));

  // ---- categories
  ipcMain.handle('categories:tree', () => cat.getCategoryTree());
  ipcMain.handle('categories:all', () => cat.getCategoriesAllDetailed());
  ipcMain.handle('categories:by-family', (_e, familleId) => cat.getCategoriesByFamily(familleId));
  ipcMain.handle('categories:create', (_e, { nom, familleId = null }) => cat.createCategory(nom, familleId));
  ipcMain.handle('categories:rename', (_e, { id, nom }) => cat.renameCategory(id, nom));
  ipcMain.handle('categories:set-family', (_e, { id, familleId = null }) => cat.setCategoryFamily(id, familleId));
  ipcMain.handle('categories:delete', (_e, id) => cat.deleteCategory(id));

  // ---- compat historique
  ipcMain.handle('get-categories', () => cat.getAllCategories());
  ipcMain.handle('get-categories-produits', () => cat.getCategoriesProduits());
}

module.exports = { registerCategoryHandlers };
