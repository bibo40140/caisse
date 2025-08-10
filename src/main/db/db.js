const Database = require('better-sqlite3');
const path = require('path');

// Création de la base
const dbPath = path.join(__dirname, '../../../coopaz.db');
const db = new Database(dbPath);

// ✅ Unités
db.prepare(`
  CREATE TABLE IF NOT EXISTS unites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT UNIQUE NOT NULL
  )
`).run();

// ✅ Catégories
db.prepare(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE
  )
`).run();



// ✅ Fournisseurs
db.prepare(`
  CREATE TABLE IF NOT EXISTS fournisseurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    contact TEXT,
    email TEXT,
    telephone TEXT,
    adresse TEXT,
    code_postal TEXT,
    ville TEXT,
    categorie_id INTEGER,
    referent_id INTEGER, -- renommé pour cohérence
    label TEXT,
    FOREIGN KEY (categorie_id) REFERENCES categories(id),
    FOREIGN KEY (referent_id) REFERENCES adherents(id)
  )
`).run();


// ✅ Produits
db.prepare(`
  CREATE TABLE IF NOT EXISTS produits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    reference TEXT UNIQUE NOT NULL,
    prix REAL NOT NULL,
    stock INTEGER NOT NULL,
    code_barre TEXT,
    unite_id INTEGER,
    fournisseur_id INTEGER,
    FOREIGN KEY (unite_id) REFERENCES unites(id),
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
  )
`).run();

// ✅ Adhérents
db.prepare(`
  CREATE TABLE IF NOT EXISTS adherents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email1 TEXT,
    email2 TEXT,
    telephone1 TEXT,
    telephone2 TEXT,
    adresse TEXT,
    code_postal TEXT,
    ville TEXT,
    nb_personnes_foyer INTEGER,
    tranche_age TEXT,
    droit_entree REAL DEFAULT 0,
    date_inscription TEXT,
    archive INTEGER DEFAULT 0,
    date_archivage TEXT,
    date_reactivation TEXT
  )
`).run();

// ✅ Ventes
db.prepare(`
  CREATE TABLE IF NOT EXISTS ventes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL,
    adherent_id INTEGER,
    date_vente TEXT DEFAULT (datetime('now', 'localtime')),
    mode_paiement TEXT,
    FOREIGN KEY(adherent_id) REFERENCES adherents(id)
  )
`).run();


// ✅ Lignes de vente
db.prepare(`
  CREATE TABLE IF NOT EXISTS lignes_vente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vente_id INTEGER,
    produit_id INTEGER,
    quantite REAL,
    prix REAL,
    FOREIGN KEY(vente_id) REFERENCES ventes(id),
    FOREIGN KEY(produit_id) REFERENCES produits(id)
  )
`).run();

// ✅ Cotisations
db.prepare(`
  CREATE TABLE IF NOT EXISTS cotisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adherent_id INTEGER NOT NULL,
    mois TEXT NOT NULL, -- format YYYY-MM
    montant REAL NOT NULL,
    date_paiement TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (adherent_id) REFERENCES adherents(id)
  )
`).run();

// ✅ Réceptions
db.prepare(`
  CREATE TABLE IF NOT EXISTS receptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    fournisseur_id INTEGER,
    bon_livraison TEXT,
    commentaire TEXT,
    utilisateur TEXT,
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
  )
`).run();

// ✅ Lignes de réception
db.prepare(`
  CREATE TABLE IF NOT EXISTS reception_lignes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reception_id INTEGER NOT NULL,
    produit_id INTEGER NOT NULL,
    quantite REAL,
    stock_corrige REAL,
    prix REAL,
    FOREIGN KEY (reception_id) REFERENCES receptions(id),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )
`).run();


module.exports = db;
