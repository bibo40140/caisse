// src/main/db/imports.js
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const db = require('./db');

// Référence produit
function genererReferenceProduit() {
  const row = db.prepare("SELECT MAX(id) as maxId FROM produits").get();
  const nextId = (row.maxId || 0) + 1;
  return `P${nextId.toString().padStart(4, '0')}`; // P0001, P0002, etc.
}

function analyserImportProduits(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const unitesConnues = db.prepare('SELECT nom FROM unites').all().map(u => u.nom.toLowerCase());

  const produits = data.map((p, index) => {
    const uniteOrigine = (p.unite || '').trim();
    const uniteMin = uniteOrigine.toLowerCase();
    const uniteExistante = unitesConnues.includes(uniteMin);

    return {
      index,
      nom: p.nom?.trim() || '',
      prix: parseFloat(p.prix || 0),
      stock: parseInt(p.stock || 0),
      code_barre: String(p.code_barre || '').trim(),
      unite_origine: uniteOrigine,
      unite_valide: uniteExistante ? uniteOrigine : null,
      unite_inconnue: !uniteExistante,
      fournisseur: String(p.fournisseur || '').trim()
    };
  });

  return {
    status: 'ok',
    produits,
    unitesConnues: db.prepare('SELECT * FROM unites').all(),
    fournisseurs: db.prepare('SELECT * FROM fournisseurs').all()
  };
}

function validerImportProduits(produitsCorriges) {
  const insert = db.prepare(`
    INSERT INTO produits (nom, prix, stock, code_barre, unite_id, fournisseur_id, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getUniteId = db.prepare('SELECT id FROM unites WHERE LOWER(nom) = ?');
  const insertUnite = db.prepare('INSERT OR IGNORE INTO unites (nom) VALUES (?)');

  const getProduitSimilaire = db.prepare(`
    SELECT * FROM produits
    WHERE LOWER(REPLACE(nom, ' ', '')) LIKE ? AND fournisseur_id = ?
  `);
  const getFournisseurNom = db.prepare('SELECT nom FROM fournisseurs WHERE id = ?');

  const modifications = [];
  let ajoutees = 0;

  for (const p of produitsCorriges) {
    const uniteNom = (p.unite || '').toLowerCase().trim();
    insertUnite.run(uniteNom);
    const unite = getUniteId.get(uniteNom);
    const unite_id = unite ? unite.id : null;

    const nomSanitise = p.nom.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const pattern = `%${nomSanitise}%`;

    const fournisseur_id = p.fournisseur_id || null;
    const produitExistant = fournisseur_id ? getProduitSimilaire.get(pattern, fournisseur_id) : null;

    if (produitExistant) {
  const fournisseurExistant = getFournisseurNom.get(produitExistant.fournisseur_id);
  const fournisseurNouveau = getFournisseurNom.get(fournisseur_id);

  modifications.push({
    existant: {
      ...produitExistant,
      fournisseur_nom: fournisseurExistant ? fournisseurExistant.nom : '—'
    },
    nouveau: {
      ...p,
      fournisseur_nom: fournisseurNouveau ? fournisseurNouveau.nom : '—'
    },
    idExistant: produitExistant.id // 🔴 C'est ça qui manquait
  });
}
 else {
      const reference = genererReferenceProduit();
      insert.run(
        p.nom,
        p.prix,
        p.stock,
        p.code_barre,
        unite_id,
        fournisseur_id,
        reference
      );
      ajoutees++;
    }
  }

  if (modifications.length > 0) {
    return { status: 'partiel', modifications, ajoutees };
  } else {
    return { status: 'ok' };
  }
}


function resoudreConflitProduit(action, nouveau, existantId = null) {
  if (!nouveau.reference || typeof nouveau.reference !== 'string') {
    // Si la référence est manquante, on la génère automatiquement
    nouveau.reference = genererReferenceProduit();
  }

  if (action === 'remplacer' && existantId) {
    db.prepare(`
      UPDATE produits
      SET nom = ?, prix = ?, stock = ?, unite_id = ?, code_barre = ?, fournisseur_id = ?, reference = ?
      WHERE id = ?
    `).run(
      nouveau.nom,
      nouveau.prix,
      nouveau.stock,
      nouveau.unite_id,
      nouveau.code_barre,
      nouveau.fournisseur_id,
      nouveau.reference,
      existantId
    );
    return { status: 'updated' };
  }

  if (action === 'ajouter') {
    db.prepare(`
      INSERT INTO produits (nom, prix, stock, unite_id, code_barre, fournisseur_id, reference)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nouveau.nom,
      nouveau.prix,
      nouveau.stock,
      nouveau.unite_id,
      nouveau.code_barre,
      nouveau.fournisseur_id,
      nouveau.reference
    );
    return { status: 'added' };
  }

  return { status: 'ignored' };
}








function analyserImportFournisseurs(filePath) {
  // ✅ Sécurité : vérifier si le chemin est valide
  if (!filePath || typeof filePath !== 'string') {
    return {
      status: 'error',
      message: 'Chemin de fichier invalide pour l’analyse des fournisseurs.'
    };
  }

  // ✅ Lecture du fichier
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  // ✅ Vérification des colonnes
  const colonnesAttendu = ['nom', 'contact', 'email', 'telephone', 'adresse', 'code_postal', 'ville', 'categorie', 'referent', 'label'];
  const colonnesPresentes = Object.keys(rows[0] || {});
  const colonnesManquantes = colonnesAttendu.filter(c => !colonnesPresentes.includes(c));

  if (colonnesManquantes.length > 0) {
    return {
      status: 'error',
      message: `Colonnes manquantes dans le fichier Excel : ${colonnesManquantes.join(', ')}`
    };
  }

  // ✅ Récupération des catégories et adhérents (referents)
  const categories = db.prepare('SELECT id, nom FROM categories').all();
  const categoriesMap = Object.fromEntries(categories.map(c => [c.nom.toLowerCase(), c.id]));

  const referents = db.prepare('SELECT id, prenom, nom FROM adherents').all();

  // ✅ Transformation des données
  const fournisseurs = rows.map(f => {
    const categorieNom = String(f.categorie || '').trim();
    const categorie_id = categoriesMap[categorieNom.toLowerCase()] || null;

    return {
      nom: String(f.nom || '').trim(),
      contact: String(f.contact || '').trim(),
      email: String(f.email || '').trim(),
      telephone: String(f.telephone || '').trim(),
      adresse: String(f.adresse || '').trim(),
      code_postal: String(f.code_postal || '').trim(),
      ville: String(f.ville || '').trim(),
      categorie_nom: categorieNom,
      categorie_id,
      referent: String(f.referent || '').trim(),
      referent_id: null,
      label: String(f.label || '').trim()
    };
  });

  return {
    status: 'ok',
    fournisseurs,
    categories,
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
        f.nom,
        f.contact,
        f.email,
        f.telephone,
        f.adresse,
        f.code_postal,
        f.ville,
        f.categorie_id,
        f.referent_id,
        f.label
      );
    }
  });

  insertMany(fournisseurs);
  return { status: 'success', message: `${fournisseurs.length} fournisseurs importés avec succès.` };
}

function resoudreConflitFournisseur(action, nouveau, existantId) {
  if (action === 'remplacer') {
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
      nouveau.nom,
      nouveau.contact,
      nouveau.email,
      nouveau.telephone,
      nouveau.adresse,
      nouveau.code_postal,
      nouveau.ville,
      nouveau.categorie_id,
      nouveau.referent_id,
      nouveau.label,
      existantId
    );
  }
}


function analyserImportAdherents(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

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
      nb_personnes_foyer: parseInt(a.nb_personnes_foyer || 0),
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
        a.nom,
        a.prenom,
        a.email1,
        a.email2,
        a.telephone1,
        a.telephone2,
        a.adresse,
        a.code_postal,
        a.ville,
        a.nb_personnes_foyer || 0,
        a.tranche_age
      );
    }
  });

  insertMany(liste);
  return { status: 'success', message: `${liste.length} adhérent(s) importés.` };
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
