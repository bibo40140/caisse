// scripts/seed-families-categories.js
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'coopaz.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// ⚠️ Arbre identique à src/main/db/db.js
const DEFAULT_TREE = [
  { famille: 'Fruits & Légumes (frais)', cats: ['Fruits frais','Légumes frais','Herbes & aromates','Champignons','Pommes de terre & tubercules','Fruits secs & oléagineux'] },
  { famille: 'Crèmerie & Œufs', cats: ['Lait & boissons lactées','Yaourts & desserts lactés','Beurre & matières grasses','Crèmes & fromages blancs','Fromages','Œufs'] },
  { famille: 'Boucherie / Charcuterie / Poissonnerie', cats: ['Viande boeuf & agneau','Viande porc','Viande autres','Volaille','Charcuterie','Poisson & fruits de mer','Alternatives végétales'] },
  { famille: 'Épicerie salée', cats: ['Pâtes, riz & céréales','Légumineuses','Conserves & bocaux','Sauces, condiments & épices','Huiles & vinaigres','Apéro salé'] },
  { famille: 'Épicerie sucrée', cats: ['Biscuits & gâteaux','Chocolat & confiseries','Confitures & pâtes à tartiner','Sucres & farines','Aides pâtisserie & levures','Miel & sirops'] },
  { famille: 'Boulangerie', cats: ['Pains & viennoiseries','Biscottes & pains grillés'] },
  { famille: 'Boissons', cats: ['Eaux','Sodas','Jus & nectars','Bières & cidres','Vins & spiritueux','Boissons chaudes'] },
  { famille: 'Surgelés', cats: ['Surgelés salés','Surgelés sucrés','Glaces'] },
  { famille: 'Bébé & Enfant', cats: ['Laits & petits pots','Couches & soins bébé','Biscuits & boissons enfant'] },
  { famille: 'Animaux', cats: ['Nourriture chiens','Nourriture chats','NAC & oiseaux'] },
  { famille: 'Hygiène & Entretien', cats: ['Hygiène','Beauté','Papeterie','Entretien','Vaisselle'] },
  { famille: 'Local / Saisonnier', cats: ['Producteurs locaux','Produits de saison','Éditions limitées'] },
  { famille: 'VRAC', cats: ['Vrac salé','Vrac sucré'] },
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

  const insertFam    = db.prepare(`INSERT OR IGNORE INTO familles (nom) VALUES (?)`);
  const getFam       = db.prepare(`SELECT id FROM familles WHERE nom = ?`);
  const insertCat    = db.prepare(`INSERT OR IGNORE INTO categories (nom, famille_id) VALUES (?, ?)`);
  const findCatAny   = db.prepare(`SELECT id, famille_id FROM categories WHERE nom = ? ORDER BY id ASC`);
  const updateCatFam = db.prepare(`UPDATE categories SET famille_id = ? WHERE id = ?`);
  const insertUnit   = db.prepare(`INSERT OR IGNORE INTO unites (nom) VALUES (?)`);

  const tx = db.transaction(() => {
    // 1) s’assurer que toutes les familles existent
    for (const grp of DEFAULT_TREE) insertFam.run(grp.famille);

    // 2) pour chaque catégorie de l’arbre : réparer orphelines / insérer manquantes
    for (const grp of DEFAULT_TREE) {
      const famId = getFam.get(grp.famille).id;
      for (const catName of grp.cats) {
        const existing = findCatAny.all(catName);

        if (existing.length === 0) {
          insertCat.run(catName, famId);
        } else {
          const orphan = existing.find(r => r.famille_id == null);
          if (orphan) {
            updateCatFam.run(famId, orphan.id);
          } else {
            const hasCorrect = existing.some(r => r.famille_id === famId);
            if (!hasCorrect) insertCat.run(catName, famId);
          }
        }
      }
    }

    // 3) unités de base
    ['kg', 'litre', 'pièce'].forEach(n => insertUnit.run(n));
  });

  tx();

  const counts = {
    familles:   db.prepare(`SELECT COUNT(*) n FROM familles`).get().n,
    categories: db.prepare(`SELECT COUNT(*) n FROM categories`).get().n,
    unites:     db.prepare(`SELECT COUNT(*) n FROM unites`).get().n,
    orphelines: db.prepare(`SELECT COUNT(*) n FROM categories WHERE famille_id IS NULL`).get().n,
  };

  console.log(`Seed/Réparation OK (DB: ${DB_PATH}) →`, counts);
  if (counts.orphelines > 0) {
    console.warn('⚠️ Des catégories sont encore orphelines. Vérifie que leurs libellés existent bien dans DEFAULT_TREE.');
  }
}

seedOrRepair();
