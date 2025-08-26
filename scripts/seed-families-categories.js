// scripts/seed-families-categories.js
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'coopaz.db'));
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
  db.prepare(`CREATE TABLE IF NOT EXISTS familles (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT UNIQUE NOT NULL)`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, famille_id INTEGER, UNIQUE(nom,famille_id), FOREIGN KEY (famille_id) REFERENCES familles(id) ON DELETE SET NULL)`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS unites (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT UNIQUE NOT NULL)`).run();
}

function seed() {
  ensureBaseTables();

  const haveFam = db.prepare(`SELECT COUNT(*) n FROM familles`).get().n;
  if (haveFam > 0) {
    console.log('familles déjà présentes → skip (on suppose base vierge juste après reset).');
    return;
  }

  const insFam  = db.prepare(`INSERT INTO familles (nom) VALUES (?)`);
  const getFam  = db.prepare(`SELECT id FROM familles WHERE nom = ?`);
  const insCat  = db.prepare(`INSERT INTO categories (nom, famille_id) VALUES (?, ?)`);

  const tx = db.transaction(() => {
    for (const grp of DEFAULT_TREE) {
      insFam.run(grp.famille);
      const famId = getFam.get(grp.famille).id;
      for (const c of grp.cats) insCat.run(c, famId);
    }
    // Unités par défaut
    const insU = db.prepare(`INSERT INTO unites (nom) VALUES (?)`);
    ['kg','litre','pièce'].forEach(n => insU.run(n));
  });
  tx();

  const counts = {
    familles: db.prepare(`SELECT COUNT(*) n FROM familles`).get().n,
    categories: db.prepare(`SELECT COUNT(*) n FROM categories`).get().n,
    unites: db.prepare(`SELECT COUNT(*) n FROM unites`).get().n,
  };
  console.log('Seed OK:', counts);
}

seed();
