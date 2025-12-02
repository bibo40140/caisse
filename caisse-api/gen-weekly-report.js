import 'dotenv/config';
// Script de génération et envoi du rapport hebdomadaire (ventes + réceptions)
import { pool } from './db/index.js';
import nodemailer from 'nodemailer';
import { getEmailSettings } from './models/emailSettingsRepo.js';
import { decryptSecret } from './utils/crypto.js';

// Récupère le début et la fin de la semaine courante (lundi 00:00 à dimanche 23:59)
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

async function getVentesHebdo(tenantId, start, end) {
  const ventes = await pool.query(
    `SELECT v.id, v.date_vente, v.total, v.mode_paiement_id, v.sale_type, v.adherent_id, v.client_email,
            mp.nom as mode_paiement_nom
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
     WHERE lv.vente_id = ANY($2::int[])`,
    [tenantId, venteIds]
  );
  return lignes.rows;
}

async function getReceptionsHebdo(tenantId, start, end) {
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

async function getLignesReception(tenantId, receptionIds) {
  if (!receptionIds.length) return [];
  const lignes = await pool.query(
    `SELECT lr.*, p.nom as produit_nom
     FROM lignes_reception lr
     LEFT JOIN produits p ON lr.produit_id = p.id AND p.tenant_id = $1
     WHERE lr.reception_id = ANY($2::int[])`,
    [tenantId, receptionIds]
  );
  return lignes.rows;
}

function computeStats(ventes, lignesVente) {
  // CA, nombre ventes, top produits, répartition modes paiement
  const ca = ventes.reduce((sum, v) => sum + Number(v.total||0), 0);
  const nbVentes = ventes.length;
  const produits = {};
  for (const l of lignesVente) {
    if (!l.produit_id) continue;
    if (!produits[l.produit_id]) produits[l.produit_id] = { nom: l.produit_nom, quantite: 0, ca: 0 };
    produits[l.produit_id].quantite += Number(l.quantite||0);
    produits[l.produit_id].ca += Number(l.prix||0) * Number(l.quantite||0);
  }
  const topProduits = Object.values(produits)
    .sort((a,b) => b.quantite - a.quantite)
    .slice(0,10);
  const modes = {};
  for (const v of ventes) {
    const nom = v.mode_paiement_nom || 'N/A';
    if (!modes[nom]) modes[nom] = 0;
    modes[nom] += 1;
  }
  return { ca, nbVentes, topProduits, modes };
}

function computeStatsReceptions(receptions, lignesReception) {
  // Nombre de réceptions, volume total, top produits reçus
  const nbReceptions = receptions.length;
  const produits = {};
  for (const l of lignesReception) {
    if (!l.produit_id) continue;
    if (!produits[l.produit_id]) produits[l.produit_id] = { nom: l.produit_nom, quantite: 0 };
    produits[l.produit_id].quantite += Number(l.quantite||0);
  }
  const topProduits = Object.values(produits)
    .sort((a,b) => b.quantite - a.quantite)
    .slice(0,10);
  return { nbReceptions, topProduits };
}

function renderHtml({ week, statsVentes, statsReceptions }) {
  return `<!DOCTYPE html>
  <html lang="fr">
  <head><meta charset="UTF-8"><title>Bilan hebdo</title>
  <style>body{font-family:sans-serif;background:#f8fafc;color:#222;margin:0;padding:0;}h1{font-size:1.5em;}table{border-collapse:collapse;width:100%;margin:18px 0;}th,td{padding:8px 6px;border-bottom:1px solid #e5e7eb;}th{background:#f1f5f9;}tr:last-child td{border-bottom:none;}.ok{color:#16a34a;font-weight:bold;}.ko{color:#dc2626;font-weight:bold;}.skip{color:#f59e42;font-weight:bold;}</style>
  </head><body><h1>Bilan hebdomadaire</h1>
  <div>Période : <b>${week.monday.toLocaleDateString()} au ${week.sunday.toLocaleDateString()}</b></div>
  <h2>Ventes</h2>
  <ul>
    <li>Chiffre d'affaires : <b>${statsVentes.ca.toFixed(2)} €</b></li>
    <li>Nombre de ventes : <b>${statsVentes.nbVentes}</b></li>
  </ul>
  <h3>Top 10 produits vendus</h3>
  <table><thead><tr><th>Produit</th><th>Quantité</th><th>CA (€)</th></tr></thead><tbody>
    ${statsVentes.topProduits.map(p => `<tr><td>${p.nom}</td><td>${p.quantite}</td><td>${p.ca.toFixed(2)}</td></tr>`).join('')}
  </tbody></table>
  <h3>Répartition par mode de paiement</h3>
  <table><thead><tr><th>Mode</th><th>Nombre</th></tr></thead><tbody>
    ${Object.entries(statsVentes.modes).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
  </tbody></table>
  <h2>Réceptions</h2>
  <ul>
    <li>Nombre de réceptions : <b>${statsReceptions.nbReceptions}</b></li>
  </ul>
  <h3>Top 10 produits reçus</h3>
  <table><thead><tr><th>Produit</th><th>Quantité</th></tr></thead><tbody>
    ${statsReceptions.topProduits.map(p => `<tr><td>${p.nom}</td><td>${p.quantite}</td></tr>`).join('')}
  </tbody></table>
  </body></html>`;
}

async function sendMail(tenantId, html) {
  const emailSettings = await getEmailSettings(tenantId);
  if (!emailSettings || !emailSettings.enabled) throw new Error('Email non configuré');
  const transporter = nodemailer.createTransport({
    host: emailSettings.host,
    port: emailSettings.port,
    secure: !!emailSettings.secure,
    auth: {
      user: emailSettings.auth_user,
      pass: decryptSecret(emailSettings.auth_pass_enc)
    }
  });
  await transporter.sendMail({
    from: `${emailSettings.from_name} <${emailSettings.from_email}>`,
    to: emailSettings.from_email,
    subject: 'Bilan hebdomadaire',
    html
  });
}

// MAIN
(async () => {
  const tenantId = process.env.TENANT_ID || 1; // à adapter si multi-tenant
  const week = getWeekRange();
  const ventes = await getVentesHebdo(tenantId, week.start, week.end);
  const lignesVente = await getLignesVente(tenantId, ventes.map(v => v.id));
  const statsVentes = computeStats(ventes, lignesVente);
  const receptions = await getReceptionsHebdo(tenantId, week.start, week.end);
  const lignesReception = await getLignesReception(tenantId, receptions.map(r => r.id));
  const statsReceptions = computeStatsReceptions(receptions, lignesReception);
  const html = renderHtml({ week, statsVentes, statsReceptions });
  await sendMail(tenantId, html);
  console.log('Bilan hebdomadaire généré et envoyé.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
