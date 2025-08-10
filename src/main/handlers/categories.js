const { ipcMain } = require('electron');
const db = require('../db/db');

module.exports = () => {
  // → Liste des catégories
  ipcMain.handle('get-categories', () => {
    return db.prepare('SELECT * FROM categories ORDER BY nom').all();
  });

  // → Ajouter une catégorie
  ipcMain.handle('ajouter-categorie', (event, nom) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO categories (nom) VALUES (?)');
    return stmt.run(nom);
  });

  // → Modifier une catégorie
  ipcMain.handle('modifier-categorie', (event, id, nom) => {
    const stmt = db.prepare('UPDATE categories SET nom = ? WHERE id = ?');
    return stmt.run(nom, id);
  });

  // → Supprimer une catégorie (avec vérification)
  ipcMain.handle('supprimer-categorie', (event, id) => {
    const fournisseurs = db.prepare(`SELECT nom FROM fournisseurs WHERE categorie_id = ?`).all(id);

    if (fournisseurs.length > 0) {
      const noms = fournisseurs.map(f => `• ${f.nom}`).join('\n');
      return `Impossible de supprimer cette catégorie car elle est associée aux fournisseurs suivants :\n\n${noms}`;
    }

    const stmt = db.prepare('DELETE FROM categories WHERE id = ?');
    stmt.run(id);
    return { success: true };
  });
};
