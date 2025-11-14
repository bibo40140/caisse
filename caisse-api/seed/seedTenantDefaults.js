// seed/seedTenantDefaults.js
export const DEFAULT_TREE = [
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

export async function seedTenantDefaults(client, tenant_id) {
  // Assumes tables: familles( id, tenant_id, nom ), categories( id, tenant_id, nom, famille_id ), unites( id, tenant_id, nom )
  // Uniques conseillés: UNIQUE(tenant_id, LOWER(nom)) sur familles/catégories/unites
  const insertFam = `
    INSERT INTO familles (tenant_id, nom)
    VALUES ($1, $2)
    ON CONFLICT (tenant_id, nom) DO NOTHING
    RETURNING id`;
  const findFam = `SELECT id FROM familles WHERE tenant_id=$1 AND nom=$2`;
  const insertCat = `
    INSERT INTO categories (tenant_id, nom, famille_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, nom, famille_id) DO NOTHING`;
  const insertUnit = `
    INSERT INTO unites (tenant_id, nom)
    VALUES ($1, $2)
    ON CONFLICT (tenant_id, nom) DO NOTHING`;

  for (const grp of DEFAULT_TREE) {
    // upsert famille
    let famRes = await client.query(findFam, [tenant_id, grp.famille]);
    let famId = famRes.rowCount ? famRes.rows[0].id : null;
    if (!famId) {
      const ins = await client.query(insertFam, [tenant_id, grp.famille]);
      famId = ins.rowCount ? ins.rows[0].id : (await client.query(findFam, [tenant_id, grp.famille])).rows[0].id;
    }
    // catégories
    for (const cat of grp.cats) {
      await client.query(insertCat, [tenant_id, cat, famId]);
    }
  }

  for (const u of ['kg','litre','pièce']) {
    await client.query(insertUnit, [tenant_id, u]);
  }
}
