// seed/seedTenantDefaults.js
// Seed par défaut pour un tenant Neon (multi-tenant)
// - Familles + catégories (DEFAULT_TREE)
// - Unités (kg, litre, pièce)
// - Modes de paiement de base (Espèces, CB, Chèque, Virement)
//
// ATTENTION : ce fichier suppose le schéma suivant (déjà en place chez toi) :
//   unites(tenant_id uuid, nom text, ...)
//   familles(tenant_id uuid, nom text, ...)
//   categories(tenant_id uuid, nom text, famille_id uuid, ...)
//   modes_paiement(tenant_id uuid, nom text, taux_percent numeric, frais_fixe numeric, actif boolean, ...)
// Avec au minimum :
//   - UNIQUE(tenant_id, nom) conseillé sur familles, categories, unites
//   - pour modes_paiement on gère les doublons par SELECT avant INSERT (pas besoin de contrainte UNIQUE)

export const DEFAULT_TREE = [
  {
    famille: 'Fruits & Légumes (frais)',
    cats: [
      'Fruits frais',
      'Légumes frais',
      'Herbes & aromates',
      'Champignons',
      'Pommes de terre & tubercules',
      'Fruits secs & oléagineux',
    ],
  },
  {
    famille: 'Crèmerie & Œufs',
    cats: [
      'Lait & boissons lactées',
      'Yaourts & desserts lactés',
      'Beurre & matières grasses',
      'Crèmes & fromages blancs',
      'Fromages',
      'Œufs',
    ],
  },
  {
    famille: 'Boucherie / Charcuterie / Poissonnerie',
    cats: [
      'Viande boeuf & agneau',
      'Viande porc',
      'Viande autres',
      'Volaille',
      'Charcuterie',
      'Poisson & fruits de mer',
      'Alternatives végétales',
    ],
  },
  {
    famille: 'Épicerie salée',
    cats: [
      'Pâtes, riz & céréales',
      'Légumineuses',
      'Conserves & bocaux',
      'Sauces, condiments & épices',
      'Huiles & vinaigres',
      'Apéro salé',
    ],
  },
  {
    famille: 'Épicerie sucrée',
    cats: [
      'Biscuits & gâteaux',
      'Chocolat & confiseries',
      'Confitures & pâtes à tartiner',
      'Sucres & farines',
      'Aides pâtisserie & levures',
      'Miel & sirops',
    ],
  },
  {
    famille: 'Boulangerie',
    cats: ['Pains & viennoiseries', 'Biscottes & pains grillés'],
  },
  {
    famille: 'Boissons',
    cats: ['Eaux', 'Sodas', 'Jus & nectars', 'Bières & cidres', 'Vins & spiritueux', 'Boissons chaudes'],
  },
  {
    famille: 'Surgelés',
    cats: ['Surgelés salés', 'Surgelés sucrés', 'Glaces'],
  },
  {
    famille: 'Bébé & Enfant',
    cats: ['Laits & petits pots', 'Couches & soins bébé', 'Biscuits & boissons enfant'],
  },
  {
    famille: 'Animaux',
    cats: ['Nourriture chiens', 'Nourriture chats', 'NAC & oiseaux'],
  },
  {
    famille: 'Hygiène & Entretien',
    cats: ['Hygiène', 'Beauté', 'Papeterie', 'Entretien', 'Vaisselle'],
  },
  {
    famille: 'Local / Saisonnier',
    cats: ['Producteurs locaux', 'Produits de saison', 'Éditions limitées'],
  },
  {
    famille: 'VRAC',
    cats: ['Vrac salé', 'Vrac sucré'],
  },
];

// Unités par défaut
export const DEFAULT_UNITS = ['kg', 'litre', 'pièce'];

// Modes de paiement par défaut
export const DEFAULT_PAYMENT_MODES = [
  { nom: 'Espèces',  taux_percent: 0, frais_fixe: 0, actif: true },
  { nom: 'CB',       taux_percent: 0, frais_fixe: 0, actif: true },
  { nom: 'Chèque',   taux_percent: 0, frais_fixe: 0, actif: true },
  { nom: 'Virement', taux_percent: 0, frais_fixe: 0, actif: true },
];

/**
 * Seed des familles, catégories, unités et (optionnel) modes de paiement
 * pour un tenant donné.
 *
 * @param {import('pg').PoolClient} client - client Postgres (pool.connect())
 * @param {string} tenantId - UUID du tenant
 * @param {object} [options]
 * @param {boolean} [options.withPayments=true] - inclure les modes de paiement
 */
export async function seedTenantDefaults(client, tenantId, options = {}) {
  const { withPayments = true } = options;

  // ---------- Familles & catégories ----------
  const insertFam = `
    INSERT INTO familles (tenant_id, nom)
    VALUES ($1, $2)
    ON CONFLICT (tenant_id, nom) DO NOTHING
    RETURNING id
  `;

  const findFam = `
    SELECT id FROM familles
    WHERE tenant_id = $1 AND nom = $2
  `;

  const insertCat = `
    INSERT INTO categories (tenant_id, nom, famille_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, nom) DO NOTHING
  `;

  for (const grp of DEFAULT_TREE) {
    const famName = grp.famille.trim();
    if (!famName) continue;

    // 1) Cherche si la famille existe déjà
    let famRes = await client.query(findFam, [tenantId, famName]);
    let famId = famRes.rowCount ? famRes.rows[0].id : null;

    // 2) Si non, l'insérer
    if (!famId) {
      const ins = await client.query(insertFam, [tenantId, famName]);
      if (ins.rowCount > 0) {
        famId = ins.rows[0].id;
      } else {
        // Cas rare : conflit concurrent → on relit
        const again = await client.query(findFam, [tenantId, famName]);
        if (again.rowCount > 0) famId = again.rows[0].id;
      }
    }

    if (!famId) {
      console.warn('[seedTenantDefaults] Impossible de récupérer famId pour', famName);
      continue;
    }

    // 3) Catégories associées
    for (const catNameRaw of grp.cats || []) {
      const catName = String(catNameRaw || '').trim();
      if (!catName) continue;
      await client.query(insertCat, [tenantId, catName, famId]);
    }
  }

  // ---------- Unités ----------
  const insertUnit = `
    INSERT INTO unites (tenant_id, nom)
    VALUES ($1, $2)
    ON CONFLICT (tenant_id, nom) DO NOTHING
  `;

  for (const u of DEFAULT_UNITS) {
    const name = String(u || '').trim();
    if (!name) continue;
    await client.query(insertUnit, [tenantId, name]);
  }

  // ---------- Modes de paiement ----------
  if (withPayments) {
    const findMode = `
      SELECT id FROM modes_paiement
      WHERE tenant_id = $1 AND nom = $2
      LIMIT 1
    `;
    const insertMode = `
      INSERT INTO modes_paiement (tenant_id, nom, taux_percent, frais_fixe, actif)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const updateMode = `
      UPDATE modes_paiement
         SET taux_percent = $3,
             frais_fixe   = $4,
             actif        = $5
       WHERE tenant_id = $1 AND nom = $2
    `;

    for (const mp of DEFAULT_PAYMENT_MODES) {
      const nom = String(mp.nom || '').trim();
      if (!nom) continue;

      const taux  = Number(mp.taux_percent ?? 0);
      const frais = Number(mp.frais_fixe   ?? 0);
      const actif = !!mp.actif;

      const existing = await client.query(findMode, [tenantId, nom]);
      if (existing.rowCount > 0) {
        // Met à jour pour garder une config cohérente
        await client.query(updateMode, [tenantId, nom, taux, frais, actif]);
      } else {
        await client.query(insertMode, [tenantId, nom, taux, frais, actif]);
      }
    }
  }

  console.log('[seedTenantDefaults] Seed terminé pour tenant', tenantId);
}
