// src/main/db/produits.js
const db = require('./db');

// Obtenir tous les produits
function getProduits() {
  return db.prepare(`
    SELECT p.*, f.nom AS fournisseur_nom, u.nom AS unite
    FROM produits p
    LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id
    LEFT JOIN unites u ON p.unite_id = u.id
    ORDER BY p.nom ASC
  `).all();
}

// Ajouter un produit
function ajouterProduit(produit) {
  const stmt = db.prepare(`
    INSERT INTO produits (nom, prix, stock, code_barre, unite_id, fournisseur_id, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const reference = genererReferenceProduit();
  stmt.run(
    produit.nom,
    produit.prix,
    produit.stock,
    produit.code_barre,
    getOrCreateUniteId(produit.unite),
    produit.fournisseur_id || null,
    reference
  );
}

// Modifier un produit
function modifierProduit(produit) {
  const stmt = db.prepare(`
    UPDATE produits SET
      nom = ?, prix = ?, stock = ?, code_barre = ?,
      unite_id = (SELECT id FROM unites WHERE LOWER(nom) = LOWER(?) LIMIT 1),
      fournisseur_id = ?
    WHERE id = ?
  `);
  stmt.run(
    produit.nom,
    produit.prix,
    produit.stock,
    produit.code_barre,
    produit.unite,
    produit.fournisseur_id || null,
    produit.id
  );
}

// Supprimer un produit
function supprimerProduit(id) {
  db.prepare('DELETE FROM produits WHERE id = ?').run(id);
}

// Supprimer et remplacer un produit
function supprimerEtRemplacerProduit(nouveau, idExistant) {
  const insert = db.prepare(`
    INSERT INTO produits (nom, prix, stock, code_barre, unite_id, fournisseur_id, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteProduit = db.prepare('DELETE FROM produits WHERE id = ?');
  const reference = genererReferenceProduit();

  deleteProduit.run(idExistant);

  insert.run(
    nouveau.nom,
    nouveau.prix,
    nouveau.stock,
    nouveau.code_barre,
    getOrCreateUniteId(nouveau.unite),
    nouveau.fournisseur_id || null,
    reference
  );

  return true;
}

// Rechercher un produit par nom + fournisseur
function rechercherProduitParNomEtFournisseur(nom, fournisseurId) {
  return db.prepare(`
    SELECT 
      p.*, f.nom AS fournisseur_nom, u.nom AS unite
    FROM produits p
    LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id
    LEFT JOIN unites u ON p.unite_id = u.id
    WHERE LOWER(p.nom) = LOWER(?) AND p.fournisseur_id = ?
    LIMIT 1
  `).get(nom.trim(), fournisseurId);
}

// Générer une référence produit unique
function genererReferenceProduit() {
  const row = db.prepare("SELECT MAX(id) as maxId FROM produits").get();
  const nextId = (row.maxId || 0) + 1;
  return `P${nextId.toString().padStart(4, '0')}`; // Ex: P0001
}

// Obtenir ou créer l'ID d'une unité (par nom)
function getOrCreateUniteId(nomUnite) {
  const nom = (nomUnite || '').toLowerCase().trim();
  if (!nom) return null;
  const insertUnite = db.prepare('INSERT OR IGNORE INTO unites (nom) VALUES (?)');
  const getUniteId = db.prepare('SELECT id FROM unites WHERE LOWER(nom) = ?');

  insertUnite.run(nom);
  const unite = getUniteId.get(nom);
  return unite ? unite.id : null;
}

module.exports = {
  getProduits,
  ajouterProduit,
  modifierProduit,
  supprimerProduit,
  supprimerEtRemplacerProduit,
  rechercherProduitParNomEtFournisseur
};
