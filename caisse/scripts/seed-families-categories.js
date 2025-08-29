// scripts/seed-families-categories.js
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'coopaz.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Arbre par défaut (parent = famille, enfants = catégories)
const DEFAULT_TREE = [
  { famille: 'Fruits & Légumes (frais)', cats: ['Fruits frais','Légumes frais','Herbes & aromates','Champignons','Pommes de terre & tubercules','Fruits secs & oléagineux'] },
  { famille: 'Crèmerie & Œufs', cats: ['Lait & boissons lactées','Yaourts & desserts lactés','Beurre & matières grasses','Crèmes & fromages blancs','Fromages','Œufs'] },
  { famille: 'Boucherie / Charcuterie / Poissonnerie', cats: ['Viande boeuf & agneau','Viande porc','Viande autres','Volaille','Charcuterie','Poisson & fruits de mer','Alternatives végétales (tofu, seitan, tempeh)'] },
  { famille: 'Épicerie salée', cats: ['Pâtes, riz & céréales','Légumineuses','Conserves & bocaux','Sauces, condiments & épices','Huiles & vinaigres','Apéro salé (chips, crackers)'] },
  { famille: 'Épicerie sucrée', cats: ['Biscuits & gâteaux','Chocolat & confiseries','Confitures & pâtes à tartiner','Sucres & farines','Aides pâtisserie & levures','Miel & sirops'] },
  { famille: 'Boulangerie', cats: ['Pains & viennoiseries','Biscottes & pains grillés'] },
  { famille: 'Boissons', cats: ['Eaux & eaux pétillantes','Sodas & boissons sans alcool','Jus & nectars','Bières & cidres','Vins & spiritueux','Boissons chaudes (café, thé, infusions, cacao)'] },
  { famille: 'Surgelés', cats: ['Surgelés salés','Surgelés sucrés','Glaces & desserts glacés'] },
  { famille: 'Bébé & Enfant', cats: ['Laits & petits pots','Couches & soins bébé','Biscuits & boissons enfant'] },
  { famille: 'Animaux', cats: ['Nourriture chiens','Nourriture chats','NAC & oiseaux'] },
  { famille: 'Hygiène & Entretien', cats: ['Hygiène corporelle','Soins & beauté','Papeterie & accessoires hygiène','Entretien maison & lessive','Vaisselle & accessoires ménage'] },
  { famille: 'Local / Saisonnier', cats: ['Producteurs locaux','Produits de saison','Éditions limitées'] },
  { famille: 'VRAC', cats: ['Vrac salé (pâtes, riz, légumineuses)','Vrac sucré (fruits secs, céréales)'] },
];

function ensureBaseTables() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS familles (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      nom  TEXT UNIQUE NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nom        TEXT NOT NULL,
      famille_id INTEGER,
      UNIQUE(nom, famille_id),
      FOREIGN KEY (famille_id) REFERENCES familles(id) ON DELETE SET NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS unites (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      nom  TEXT UNIQUE NOT NULL
    )
  `).run();
}

function seedOrRepair() {
  ensureBaseTables();

  const insertFam = db.prepare(`INSERT OR IGNORE INTO familles (nom) VALUES (?)`);
  const getFam    = db.prepare(`SELECT id FROM familles WHERE nom = ?`);
  const insertCat = db.prepare(`INSERT OR IGNORE INTO categories (nom, famille_id) VALUES (?, ?)`);
  const findCatAny = db.prepare(`SELECT id, famille_id FROM categories WHERE nom = ? ORDER BY id ASC`);
  const updateCatFam = db.prepare(`UPDATE categories SET famille_id = ? WHERE id = ?`);
  const insertUnit = db.prepare(`INSERT OR IGNORE INTO unites (nom) VALUES (?)`);

  const tx = db.transaction(() => {
    // 1) S'assurer que toutes les familles existent
    for (const grp of DEFAULT_TREE) {
      insertFam.run(grp.famille);
    }

    // 2) Pour chaque catégorie de l'arbre :
    //    - si une ligne "categories" existe déjà avec ce nom mais famille_id NULL → on la répare (UPDATE)
    //    - sinon on insère la (nom, famille_id) si manquante
    for (const grp of DEFAULT_TREE) {
      const famId = getFam.get(grp.famille).id;

      for (const catName of grp.cats) {
        const existing = findCatAny.all(catName);

        if (existing.length === 0) {
          // catégorie absente → insertion
          insertCat.run(catName, famId);
        } else {
          // Au moins une ligne porte déjà ce nom
          // On cherche si l'une est orpheline (famille_id NULL) à réparer en priorité
          const orphan = existing.find(r => r.famille_id == null);
          if (orphan) {
            updateCatFam.run(famId, orphan.id);
          } else {
            // Si aucune orpheline, vérifie si une entrée (nom, famId) existe déjà.
            const hasCorrect = existing.some(r => r.famille_id === famId);
            if (!hasCorrect) {
              // On ajoute la combinaison correcte (nom, famId) si pas déjà là
              insertCat.run(catName, famId);
            }
          }
        }
      }
    }

    // 3) Unités par défaut
    ['kg', 'litre', 'pièce'].forEach(n => insertUnit.run(n));
  });

  tx();

  const counts = {
    familles: db.prepare(`SELECT COUNT(*) n FROM familles`).get().n,
    categories: db.prepare(`SELECT COUNT(*) n FROM categories`).get().n,
    unites: db.prepare(`SELECT COUNT(*) n FROM unites`).get().n,
    orphelines: db.prepare(`SELECT COUNT(*) n FROM categories WHERE famille_id IS NULL`).get().n,
  };

  console.log(`Seed/Réparation OK (DB: ${DB_PATH}) →`, counts);
  if (counts.orphelines > 0) {
    console.warn('⚠️ Il reste des catégories orphelines (famille_id = NULL). Vérifie que leurs libellés existent bien dans DEFAULT_TREE.');
  }
}

seedOrRepair();
