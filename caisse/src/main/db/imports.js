// src/main/db/imports.js
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const db = require('./db');
// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
/**
 * Normalise un nom de catégorie pour filtrer les libellés indésirables.
 * Retourne:
 *  - null si le libellé doit être ignoré (autre/none/…)
 *  - la chaîne originale (trimée) sinon (on garde l’original pour le mapping exact).
 */
function normalizeCategoryName(raw) {
  const str = String(raw || '').trim();
  const clean = str
    .normalize('NFD').replace(/\p{Diacritic}/gu, '') // retire les accents
    .toLowerCase();
  const BLACKLIST = new Set(['', 'autre', 'other', 'others', 'none', 'n/a', 'na', 'sans', 'aucune']);
  if (BLACKLIST.has(clean)) return null;
  return str;
}
/**
 * Recharge les catégories depuis la DB et renvoie l’id par nom (case-insensitive).
 * Ne crée JAMAIS de catégorie.
 */
function getCategoryIdByName(catName) {
  if (!catName) return null;
  const categories = db.prepare('SELECT id, nom FROM categories').all();
  const byLower = Object.fromEntries(categories.map(c => [c.nom.toLowerCase(), c.id]));
  return byLower[String(catName).toLowerCase()] || null;
}
/**
 * Converti de façon safe les nombres (prix/stock…).
 */
function toFloatSafe(v, def = 0) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
function toIntSafe(v, def = 0) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : def;
}
// Référence produit (simple incrément sur id max)
function genererReferenceProduit() {
  const row = db.prepare("SELECT MAX(id) as maxId FROM produits").get();
  const nextId = (row.maxId || 0) + 1;
  return `P${nextId.toString().padStart(4, '0')}`; // P0001, P0002, etc.
}
// ─────────────────────────────────────────────────────────────
// IMPORT PRODUITS
// ─────────────────────────────────────────────────────────────
function analyserImportProduits(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { status: 'error', message: 'Chemin de fichier invalide pour l’analyse des produits.' };
  }
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!Array.isArray(data) || data.length === 0) {
    return { status: 'error', message: 'Aucune donnée produit détectée dans le fichier.' };
  }
  // Récupération référentiels connus
  const unites = db.prepare('SELECT * FROM unites').all();
  const unitesConnues = unites.map(u => (u.nom || '').toLowerCase());
  const fournisseurs = db.prepare('SELECT * FROM fournisseurs').all();
  // NOTE: on ne charge pas les catégories en amont ici, on fait un mapping "live"
  // via getCategoryIdByName pour éviter tout cache stale.
  const produits = data.map((p, index) => {
    const uniteOrigine = String(p.unite || '').trim();
    const uniteMin = uniteOrigine.toLowerCase();
    const uniteExistante = unitesConnues.includes(uniteMin);
    const catNameRaw = normalizeCategoryName(p.categorie);
    const categorie_id = getCategoryIdByName(catNameRaw); // peut être null si inconnu/blacklist
    return {
      index,
      nom: String(p.nom || '').trim(),
      prix: toFloatSafe(p.prix, 0),
      stock: toIntSafe(p.stock, 0),
      code_barre: String(p.code_barre || '').trim(),
      unite_origine: uniteOrigine,
      unite_valide: uniteExistante ? uniteOrigine : null,
      unite_inconnue: !uniteExistante,
      fournisseur: String(p.fournisseur || '').trim(),
      // catégorie produit (optionnelle, jamais créée)
      categorie_nom: catNameRaw || '',
      categorie_id
    };
  });
  return {
    status: 'ok',
    produits,
    unitesConnues: unites,
    fournisseurs
  };
}
function validerImportProduits(produitsCorriges) {
  // Vérifier unité + fournisseur
  const manquants = produitsCorriges.filter(p => !p.fournisseur_id || !p.unite);
  if (manquants.length > 0) {
    return {
      status: 'error',
      message: 'Certains produits n’ont pas d’unité ou de fournisseur.',
      manquants
    };
    }
  const insert = db.prepare(`
    INSERT INTO produits (nom, prix, stock, code_barre, unite_id, fournisseur_id, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // Les unités peuvent s’enrichir (on accepte INSERT OR IGNORE)
  const getUniteId = db.prepare('SELECT id FROM unites WHERE LOWER(nom) = ?');
  const insUnite   = db.prepare('INSERT OR IGNORE INTO unites (nom) VALUES (?)');
  // ⚠️ Catégories: NE JAMAIS CRÉER. On mappe seulement vers l’existant.
  const getProduitSimilaire = db.prepare(`
    SELECT * FROM produits
    WHERE LOWER(REPLACE(nom, ' ', '')) LIKE ? AND fournisseur_id = ?
  `);
  const getFournisseurNom = db.prepare('SELECT nom FROM fournisseurs WHERE id = ?');
  const modifications = [];
  let ajoutees = 0;
  for (const p of produitsCorriges) {
    // Unité
    const uniteNom = String(p.unite || '').toLowerCase().trim();
    if (uniteNom) insUnite.run(uniteNom);
    const unite = getUniteId.get(uniteNom);
    const unite_id = unite ? unite.id : null;
    // Catégorie (optionnelle) — on NE crée PAS; on remap "live"
    const catId = getCategoryIdByName(normalizeCategoryName(p.categorie_nom));
    // Doublon chez ce fournisseur ?
    const nomSanitise = String(p.nom || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
    const pattern = `%${nomSanitise}%`;
    const fournisseur_id = p.fournisseur_id || null;
    const produitExistant = fournisseur_id ? getProduitSimilaire.get(pattern, fournisseur_id) : null;
    if (produitExistant) {
      const fournisseurExistant = getFournisseurNom.get(produitExistant.fournisseur_id);
      const fournisseurNouveau  = getFournisseurNom.get(fournisseur_id);
      modifications.push({
        existant: { ...produitExistant, fournisseur_nom: fournisseurExistant ? fournisseurExistant.nom : '—' },
        nouveau:  { ...p, unite_id, fournisseur_nom: fournisseurNouveau ? fournisseurNouveau.nom : '—', categorie_id: catId },
        idExistant: produitExistant.id
      });
    } else {
      // Nouvelle réf
      const reference = genererReferenceProduit();
      const info = insert.run(
        p.nom,
        toFloatSafe(p.prix, 0),
        toIntSafe(p.stock, 0),
        p.code_barre || null,
        unite_id,
        fournisseur_id,
        reference
      );
      if (catId) {
        db.prepare('UPDATE produits SET categorie_id = ? WHERE id = ?').run(catId, info.lastInsertRowid);
      }
      ajoutees++;
    }
  }
  if (modifications.length > 0) {
    return { status: 'partiel', modifications, ajoutees };
  } else {
    return { status: 'ok' };
  }
}
function genererReferenceProduitUnique() {
  let ref;
  let existe;
  do {
    const row = db.prepare("SELECT MAX(id) as maxId FROM produits").get();
    const nextId = (row.maxId || 0) + 1;
    ref = `P${nextId.toString().padStart(4, '0')}`;
    existe = db.prepare("SELECT 1 FROM produits WHERE reference = ?").get(ref);
  } while (existe);
  return ref;
}
function resoudreConflitProduit(action, nouveau, existantId = null) {
  // Toujours régénérer une référence unique
  const reference = genererReferenceProduit();
  // Catégorie (optionnelle) — pas de création
  const catId = getCategoryIdByName(normalizeCategoryName(nouveau.categorie_nom)) || nouveau.categorie_id || null;
  if (action === 'remplacer' && existantId) {
    // Mise à jour de la fiche existante
    db.prepare(`
      UPDATE produits
      SET nom = ?, prix = ?, stock = ?, unite_id = ?, code_barre = ?, fournisseur_id = ?, reference = reference
      WHERE id = ?
    `).run(
      String(nouveau.nom || '').trim(),
      toFloatSafe(nouveau.prix, 0),
      toIntSafe(nouveau.stock, 0),
      nouveau.unite_id || null,
      nouveau.code_barre || null,
      nouveau.fournisseur_id || null,
      existantId
    );
    if (catId !== null) {
      db.prepare('UPDATE produits SET categorie_id = ? WHERE id = ?').run(catId, existantId);
    }
    return { status: 'updated' };
  }
  if (action === 'ajouter') {
    const info = db.prepare(`
      INSERT INTO produits (nom, prix, stock, unite_id, code_barre, fournisseur_id, reference)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(nouveau.nom || '').trim(),
      toFloatSafe(nouveau.prix, 0),
      toIntSafe(nouveau.stock, 0),
      nouveau.unite_id || null,
      nouveau.code_barre || null,
      nouveau.fournisseur_id || null,
      reference
    );
    if (catId) {
      db.prepare('UPDATE produits SET categorie_id = ? WHERE id = ?').run(catId, info.lastInsertRowid);
    }
    return { status: 'added' };
  }
  return { status: 'ignored' };
}
// ─────────────────────────────────────────────────────────────
// IMPORT FOURNISSEURS
// ─────────────────────────────────────────────────────────────
function analyserImportFournisseurs(filePath) {
  // Sécurité chemin
  if (!filePath || typeof filePath !== 'string') {
    return {
      status: 'error',
      message: 'Chemin de fichier invalide pour l’analyse des fournisseurs.'
    };
  }
  // Lecture du fichier
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'error', message: 'Aucune donnée fournisseur détectée dans le fichier.' };
  }
  // Vérification des colonnes
  const colonnesAttendu = ['nom', 'contact', 'email', 'telephone', 'adresse', 'code_postal', 'ville', 'categorie', 'referent', 'label'];
  const colonnesPresentes = Object.keys(rows[0] || {});
  const colonnesManquantes = colonnesAttendu.filter(c => !colonnesPresentes.includes(c));
  if (colonnesManquantes.length > 0) {
    return {
      status: 'error',
      message: `Colonnes manquantes dans le fichier Excel : ${colonnesManquantes.join(', ')}`
    };
  }
  // Récupération des référents (adherents)
  const referents = db.prepare('SELECT id, prenom, nom FROM adherents').all();
  // Transformation des données (mapping catégorie SANS création)
  const fournisseurs = rows.map(f => {
    const catName = normalizeCategoryName(f.categorie);
    const categorie_id = getCategoryIdByName(catName); // null si inconnu/blacklist
    return {
      nom: String(f.nom || '').trim(),
      contact: String(f.contact || '').trim(),
      email: String(f.email || '').trim(),
      telephone: String(f.telephone || '').trim(),
      adresse: String(f.adresse || '').trim(),
      code_postal: String(f.code_postal || '').trim(),
      ville: String(f.ville || '').trim(),
      categorie_nom: catName || '',
      categorie_id,
      referent: String(f.referent || '').trim(),
      referent_id: null, // rempli via UI/étape suivante
      label: String(f.label || '').trim()
    };
  });
  // On renvoie aussi la liste de catégories “officielles” pour UI (sélecteurs éventuels)
  const categoriesOfficial = db.prepare('SELECT id, nom FROM categories ORDER BY nom').all();
  return {
    status: 'ok',
    fournisseurs,
    categories: categoriesOfficial,
    referents
  };
}
function validerImportFournisseurs(fournisseurs) {
  const insert = db.prepare(`
    INSERT INTO fournisseurs 
    (nom, contact, email, telephone, adresse, code_postal, ville, categorie_id, referent_id, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((liste) => {
    for (const f of liste) {
      insert.run(
        String(f.nom || '').trim(),
        String(f.contact || '').trim(),
        String(f.email || '').trim(),
        String(f.telephone || '').trim(),
        String(f.adresse || '').trim(),
        String(f.code_postal || '').trim(),
        String(f.ville || '').trim(),
        f.categorie_id || null,
        f.referent_id || null,
        String(f.label || '').trim()
      );
    }
  });
  insertMany(fournisseurs);
  return { status: 'success', message: `${fournisseurs.length} fournisseur(s) importé(s) avec succès.` };
}
function resoudreConflitFournisseur(action, nouveau, existantId) {
  if (action === 'remplacer') {
    const catId = getCategoryIdByName(normalizeCategoryName(nouveau.categorie_nom)) || nouveau.categorie_id || null;
    db.prepare(`
      UPDATE fournisseurs SET 
        nom = ?, 
        contact = ?, 
        email = ?, 
        telephone = ?, 
        adresse = ?, 
        code_postal = ?, 
        ville = ?, 
        categorie_id = ?, 
        referent_id = ?, 
        label = ?
      WHERE id = ?
    `).run(
      String(nouveau.nom || '').trim(),
      String(nouveau.contact || '').trim(),
      String(nouveau.email || '').trim(),
      String(nouveau.telephone || '').trim(),
      String(nouveau.adresse || '').trim(),
      String(nouveau.code_postal || '').trim(),
      String(nouveau.ville || '').trim(),
      catId,
      nouveau.referent_id || null,
      String(nouveau.label || '').trim(),
      existantId
    );
    return { status: 'updated' };
  }
  return { status: 'ignored' };
}
// ─────────────────────────────────────────────────────────────
// IMPORT ADHERENTS
// ─────────────────────────────────────────────────────────────
function analyserImportAdherents(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { status: 'error', message: 'Chemin de fichier invalide pour l’analyse des adhérents.' };
  }
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'error', message: 'Aucune donnée adhérent détectée dans le fichier.' };
  }
  const attendus = [
    "nom", "prenom", "email1", "email2", "telephone1", "telephone2",
    "adresse", "code_postal", "ville", "nb_personnes_foyer", "tranche_age"
  ];
  const colonnes = Object.keys(rows[0] || {});
  const manquantes = attendus.filter(c => !colonnes.includes(c));
  if (manquantes.length > 0) {
    return { status: 'error', message: `Colonnes manquantes : ${manquantes.join(', ')}` };
  }
  const TRANCHES_AGE_VALIDES = ["18-25", "26-35", "36-45", "46-55", "56-65", "66+"];
  const adherents = rows.map(a => {
    return {
      nom: String(a.nom || '').trim(),
      prenom: String(a.prenom || '').trim(),
      email1: String(a.email1 || '').trim(),
      email2: String(a.email2 || '').trim(),
      telephone1: String(a.telephone1 || '').trim(),
      telephone2: String(a.telephone2 || '').trim(),
      adresse: String(a.adresse || '').trim(),
      code_postal: String(a.code_postal || '').trim(),
      ville: String(a.ville || '').trim(),
      nb_personnes_foyer: toIntSafe(a.nb_personnes_foyer, 0),
      tranche_age: String(a.tranche_age || '').trim(),
      date_inscription: String(a.date_inscription || '').trim(),
      date_archivage: String(a.date_archivage || '').trim(),
      date_reactivation: String(a.date_reactivation || '').trim(),
      tranche_valide: TRANCHES_AGE_VALIDES.includes(String(a.tranche_age || '').trim())
    };
  });
  return {
    status: 'ok',
    adherents,
    tranches_age: TRANCHES_AGE_VALIDES
  };
}
function validerImportAdherents(liste) {
  const insert = db.prepare(`
    INSERT INTO adherents (
      nom, prenom, email1, email2, telephone1, telephone2,
      adresse, code_postal, ville, nb_personnes_foyer, tranche_age
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((data) => {
    for (const a of data) {
      insert.run(
        String(a.nom || '').trim(),
        String(a.prenom || '').trim(),
        String(a.email1 || '').trim(),
        String(a.email2 || '').trim(),
        String(a.telephone1 || '').trim(),
        String(a.telephone2 || '').trim(),
        String(a.adresse || '').trim(),
        String(a.code_postal || '').trim(),
        String(a.ville || '').trim(),
        toIntSafe(a.nb_personnes_foyer, 0),
        String(a.tranche_age || '').trim()
      );
    }
  });
  insertMany(liste);
  return { status: 'success', message: `${liste.length} adhérent(s) importé(s).` };
}
module.exports = {
  analyserImportProduits,
  validerImportProduits,
  resoudreConflitProduit,
  analyserImportFournisseurs,
  validerImportFournisseurs,
  resoudreConflitFournisseur,
  analyserImportAdherents,
  validerImportAdherents
};