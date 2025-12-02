// routes/stats.js
import express from 'express';
import { pool } from '../db/index.js';

const router = express.Router();

function getWeekRange(now = new Date()) {
  const d = new Date(now);
  d.setHours(0,0,0,0);
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);
  return {
    start: monday.toISOString(),
    end: sunday.toISOString(),
    monday,
    sunday
  };
}

function getMonthRange(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    start: first.toISOString(),
    end: last.toISOString(),
    first,
    last
  };
}

// Utilitaires pour stats (ventes, réceptions)
async function getVentes(tenantId, start, end) {
  // Schéma Neon: colonnes = date_vente (timestamptz), total (numeric)
  // On renomme date_vente en date pour simplifier l'usage côté stats
  const ventes = await pool.query(
    `SELECT v.id, v.date_vente AS date, v.total, v.mode_paiement_id, v.adherent_id,
            mp.nom AS mode_paiement_nom
     FROM ventes v
     LEFT JOIN modes_paiement mp ON v.mode_paiement_id = mp.id AND mp.tenant_id = v.tenant_id
     WHERE v.tenant_id = $1 AND v.date_vente >= $2 AND v.date_vente <= $3
     ORDER BY v.date_vente ASC`,
    [tenantId, start, end]
  );
  return ventes.rows;
}

async function getLignesVente(tenantId, venteIds) {
  if (!venteIds.length) return [];
  const lignes = await pool.query(
    `SELECT lv.*, p.nom as produit_nom
     FROM lignes_vente lv
     LEFT JOIN produits p ON lv.produit_id = p.id AND p.tenant_id = $1
     WHERE lv.vente_id = ANY($2::uuid[])`,
    [tenantId, venteIds]
  );
  return lignes.rows;
}

async function getReceptions(tenantId, start, end) {
  const recs = await pool.query(
    `SELECT r.id, r.date, r.fournisseur_id, f.nom as fournisseur_nom
     FROM receptions r
     LEFT JOIN fournisseurs f ON r.fournisseur_id = f.id AND f.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.date >= $2 AND r.date <= $3
     ORDER BY r.date ASC`,
    [tenantId, start, end]
  );
  return recs.rows;
}

async function getLignesReception(tenantId, recIds) {
  if (!recIds.length) return [];
  const lignes = await pool.query(
    `SELECT lr.*, p.nom as produit_nom
     FROM lignes_reception lr
     LEFT JOIN produits p ON lr.produit_id = p.id AND p.tenant_id = $1
     WHERE lr.reception_id = ANY($2::uuid[])`,
    [tenantId, recIds]
  );
  return lignes.rows;
}

function computeStats(ventes, lignesVente) {
  const ca = ventes.reduce((sum, v) => sum + Number(v.total || 0), 0);
  const nbVentes = ventes.length;
  const modes = {};
  ventes.forEach(v => {
    const nom = v.mode_paiement_nom || 'Inconnu';
    modes[nom] = (modes[nom] || 0) + 1;
  });
  // Top produits
  const produits = {};
  lignesVente.forEach(lv => {
    if (!lv.produit_nom) return;
    if (!produits[lv.produit_nom]) produits[lv.produit_nom] = { nom: lv.produit_nom, quantite: 0, ca: 0 };
    produits[lv.produit_nom].quantite += Number(lv.quantite || 0);
    // Utiliser le champ 'prix' qui contient le total de la ligne
    produits[lv.produit_nom].ca += Number(lv.prix || 0);
  });
  const topProduits = Object.values(produits).sort((a,b) => b.quantite - a.quantite).slice(0,10);
  return { ca, nbVentes, modes, topProduits };
}

function computeStatsReceptions(receptions, lignesReception) {
  const nbReceptions = receptions.length;
  const produits = {};
  lignesReception.forEach(lr => {
    if (!lr.produit_nom) return;
    if (!produits[lr.produit_nom]) produits[lr.produit_nom] = { nom: lr.produit_nom, quantite: 0 };
    produits[lr.produit_nom].quantite += Number(lr.quantite || 0);
  });
  const topProduits = Object.values(produits).sort((a,b) => b.quantite - a.quantite).slice(0,10);
  return { nbReceptions, topProduits };
}

// Route principale
router.get('/', async (req, res) => {
  try {
    // Déterminer le tenant ciblé: priorité à req.user (si route protégée), puis query, enfin fallback premier tenant.
    let tenantId = (req.user && req.user.tenantId) || req.query.tenant_id || null;
    if (!tenantId) {
      const firstTenant = await pool.query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
      if (firstTenant.rowCount === 0) {
        return res.status(500).json({ error: 'Aucun tenant trouvé dans la base' });
      }
      tenantId = firstTenant.rows[0].id;
    }

    // Plages temporelles
    const nowIso = new Date().toISOString();
    const week = getWeekRange();
    const month = getMonthRange();

    // VENTES
    const ventesHebdo = await getVentes(tenantId, week.start, week.end);
    const lignesVenteHebdo = await getLignesVente(tenantId, ventesHebdo.map(v => v.id));
    const statsVentesHebdo = computeStats(ventesHebdo, lignesVenteHebdo);

    const ventesMois = await getVentes(tenantId, month.start, month.end);
    const lignesVenteMois = await getLignesVente(tenantId, ventesMois.map(v => v.id));
    const statsVentesMois = computeStats(ventesMois, lignesVenteMois);

    const ventesAll = await getVentes(tenantId, '2000-01-01', nowIso);
    const lignesVenteAll = await getLignesVente(tenantId, ventesAll.map(v => v.id));
    const statsVentesAll = computeStats(ventesAll, lignesVenteAll);

    // RECEPTIONS
    const receptionsHebdo = await getReceptions(tenantId, week.start, week.end);
    const lignesReceptionHebdo = await getLignesReception(tenantId, receptionsHebdo.map(r => r.id));
    const statsReceptionsHebdo = computeStatsReceptions(receptionsHebdo, lignesReceptionHebdo);

    const receptionsMois = await getReceptions(tenantId, month.start, month.end);
    const lignesReceptionMois = await getLignesReception(tenantId, receptionsMois.map(r => r.id));
    const statsReceptionsMois = computeStatsReceptions(receptionsMois, lignesReceptionMois);

    const receptionsAll = await getReceptions(tenantId, '2000-01-01', nowIso);
    const lignesReceptionAll = await getLignesReception(tenantId, receptionsAll.map(r => r.id));
    const statsReceptionsAll = computeStatsReceptions(receptionsAll, lignesReceptionAll);

    res.json({
      hebdo: { ventes: statsVentesHebdo, receptions: statsReceptionsHebdo },
      mensuelles: { ventes: statsVentesMois, receptions: statsReceptionsMois },
      globales: { ventes: statsVentesAll, receptions: statsReceptionsAll },
      meta: {
        tenant_id: tenantId,
        counts: {
          ventes_hebdo: ventesHebdo.length,
          ventes_mois: ventesMois.length,
          ventes_all: ventesAll.length,
          receptions_hebdo: receptionsHebdo.length,
          receptions_mois: receptionsMois.length,
          receptions_all: receptionsAll.length
        },
        ranges: {
          week_start: week.start,
            week_end: week.end,
          month_start: month.start,
            month_end: month.end
        }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
