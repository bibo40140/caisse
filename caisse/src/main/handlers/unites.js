const { ipcMain } = require('electron');
const db = require('../db/db');

module.exports = function registerUniteHandlers(ipcMain) {

  // → Récupérer les unités
  ipcMain.handle('get-unites', () => {
    return db.prepare('SELECT * FROM unites ORDER BY nom').all();
  });

  // → Ajouter une unité
  ipcMain.handle('ajouter-unite', (event, nom) => {
    const stmt = db.prepare('INSERT OR IGNORE INTO unites (nom) VALUES (?)');
    return stmt.run(nom);
  });

  // → Modifier une unité
  ipcMain.handle('modifier-unite', (event, id, nom) => {
    const stmt = db.prepare('UPDATE unites SET nom = ? WHERE id = ?');
    return stmt.run(nom, id);
  });

  // → Supprimer une unité (avec vérification)
  ipcMain.handle('supprimer-unite', (event, id) => {
    const count = db.prepare('SELECT COUNT(*) AS total FROM produits WHERE unite_id = ?').get(id);
    if (count.total > 0) {
      return `Impossible de supprimer : ${count.total} produit(s) utilisent cette unité.`;
    }
    db.prepare('DELETE FROM unites WHERE id = ?').run(id);
    return true;
  });

  // ✅ Ajouter les unités par défaut si elles n'existent pas
  const unitesParDefaut = ['kg', 'litre', 'pièce'];
  const unitesExistantes = db.prepare('SELECT nom FROM unites').all().map(u => u.nom.toLowerCase());

  const insertUnite = db.prepare('INSERT INTO unites (nom) VALUES (?)');
  const insertUnitesDefaut = db.transaction((unites) => {
    for (const unite of unites) {
      if (!unitesExistantes.includes(unite.toLowerCase())) {
        insertUnite.run(unite);
      }
    }
  });

  insertUnitesDefaut(unitesParDefaut);
};
