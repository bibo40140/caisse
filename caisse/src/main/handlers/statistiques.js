// src/main/handlers/statistiques.js
const db = require('../db/db');

/**
 * Récupère les statistiques de ventes sur une période
 */
function getVentesStats(days = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split('T')[0];

    // Total et nombre de ventes
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total
      FROM ventes
      WHERE date(date_vente) >= date(?)
    `).get(cutoff);

    // Ventes par jour
    const byDay = db.prepare(`
      SELECT 
        date(date_vente) as date,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total
      FROM ventes
      WHERE date(date_vente) >= date(?)
      GROUP BY date(date_vente)
      ORDER BY date(date_vente)
    `).all(cutoff);

    // Ventes par produit (top produits)
    const byProduct = db.prepare(`
      SELECT 
        p.id,
        p.nom,
        p.reference,
        SUM(lv.quantite) as quantity,
        SUM(lv.prix) as revenue
      FROM lignes_vente lv
      JOIN ventes v ON v.id = lv.vente_id
      JOIN produits p ON p.id = lv.produit_id
      WHERE date(v.date_vente) >= date(?)
      GROUP BY p.id, p.nom, p.reference
      ORDER BY revenue DESC
      LIMIT 20
    `).all(cutoff);

    return {
      total: summary.total || 0,
      count: summary.count || 0,
      byDay: byDay || [],
      byProduct: byProduct || []
    };
  } catch (e) {
    console.error('[Stats] getVentesStats error:', e);
    return { total: 0, count: 0, byDay: [], byProduct: [] };
  }
}

/**
 * Récupère les statistiques de réceptions sur une période
 */
function getReceptionsStats(days = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split('T')[0];

    // Total et nombre de réceptions
    const summary = db.prepare(`
      SELECT 
        COUNT(DISTINCT r.id) as count,
        COALESCE(SUM(lr.quantite * lr.prix_unitaire), 0) as total
      FROM receptions r
      LEFT JOIN lignes_reception lr ON lr.reception_id = r.id
      WHERE date(r.date) >= date(?)
    `).get(cutoff);

    // Réceptions par jour
    const byDay = db.prepare(`
      SELECT 
        date(r.date) as date,
        COUNT(DISTINCT r.id) as count,
        COALESCE(SUM(lr.quantite), 0) as quantity,
        COALESCE(SUM(lr.quantite * lr.prix_unitaire), 0) as total
      FROM receptions r
      LEFT JOIN lignes_reception lr ON lr.reception_id = r.id
      WHERE date(r.date) >= date(?)
      GROUP BY date(r.date)
      ORDER BY date(r.date)
    `).all(cutoff);

    return {
      total: summary.total || 0,
      count: summary.count || 0,
      byDay: byDay || []
    };
  } catch (e) {
    console.error('[Stats] getReceptionsStats error:', e);
    return { total: 0, count: 0, byDay: [] };
  }
}

/**
 * Récupère les statistiques de ventes sur une plage de dates
 */
function getVentesStatsByRange(dateFrom, dateTo) {
  try {
    // Total et nombre de ventes
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total
      FROM ventes
      WHERE date(date_vente) BETWEEN date(?) AND date(?)
    `).get(dateFrom, dateTo);

    // Ventes par jour
    const byDay = db.prepare(`
      SELECT 
        date(date_vente) as date,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total,
        COALESCE(SUM(
          (SELECT SUM(quantite) FROM lignes_vente WHERE vente_id = ventes.id)
        ), 0) as quantity
      FROM ventes
      WHERE date(date_vente) BETWEEN date(?) AND date(?)
      GROUP BY date(date_vente)
      ORDER BY date(date_vente)
    `).all(dateFrom, dateTo);

    // Ventes par produit (top produits)
    const byProduct = db.prepare(`
      SELECT 
        p.id,
        p.nom,
        p.reference,
        SUM(lv.quantite) as quantity,
        SUM(lv.prix) as revenue
      FROM lignes_vente lv
      JOIN ventes v ON v.id = lv.vente_id
      JOIN produits p ON p.id = lv.produit_id
      WHERE date(v.date_vente) BETWEEN date(?) AND date(?)
      GROUP BY p.id, p.nom, p.reference
      ORDER BY revenue DESC
      LIMIT 20
    `).all(dateFrom, dateTo);

    return {
      total: summary.total || 0,
      count: summary.count || 0,
      byDay: byDay || [],
      byProduct: byProduct || []
    };
  } catch (e) {
    console.error('[Stats] getVentesStatsByRange error:', e);
    return { total: 0, count: 0, byDay: [], byProduct: [] };
  }
}

/**
 * Récupère les statistiques de réceptions sur une plage de dates
 */
function getReceptionsStatsByRange(dateFrom, dateTo) {
  try {
    // Total et nombre de réceptions
    const summary = db.prepare(`
      SELECT 
        COUNT(DISTINCT r.id) as count,
        COALESCE(SUM(lr.quantite * lr.prix_unitaire), 0) as total
      FROM receptions r
      LEFT JOIN lignes_reception lr ON lr.reception_id = r.id
      WHERE date(r.date) BETWEEN date(?) AND date(?)
    `).get(dateFrom, dateTo);

    // Réceptions par jour
    const byDay = db.prepare(`
      SELECT 
        date(r.date) as date,
        COUNT(DISTINCT r.id) as count,
        COALESCE(SUM(lr.quantite), 0) as quantity,
        COALESCE(SUM(lr.quantite * lr.prix_unitaire), 0) as total
      FROM receptions r
      LEFT JOIN lignes_reception lr ON lr.reception_id = r.id
      WHERE date(r.date) BETWEEN date(?) AND date(?)
      GROUP BY date(r.date)
      ORDER BY date(r.date)
    `).all(dateFrom, dateTo);

    return {
      total: summary.total || 0,
      count: summary.count || 0,
      byDay: byDay || []
    };
  } catch (e) {
    console.error('[Stats] getReceptionsStatsByRange error:', e);
    return { total: 0, count: 0, byDay: [] };
  }
}

/**
 * Récupère le nombre total de produits
 */
function getProduitsCount() {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM produits').get();
    return result.count || 0;
  } catch (e) {
    console.error('[Stats] getProduitsCount error:', e);
    return 0;
  }
}

/**
 * Enregistre les handlers IPC pour les statistiques
 */
function registerStatistiquesHandlers(ipcMain) {
  const channels = [
    'stats:ventes',
    'stats:receptions',
    'stats:produits-count',
    'stats:ventes-range',
    'stats:receptions-range'
  ];

  channels.forEach((ch) => {
    try {
      ipcMain.removeHandler(ch);
    } catch {}
  });

  ipcMain.handle('stats:ventes', async (_evt, days = 30) => {
    return getVentesStats(days);
  });

  ipcMain.handle('stats:receptions', async (_evt, days = 30) => {
    return getReceptionsStats(days);
  });

  ipcMain.handle('stats:produits-count', async () => {
    return getProduitsCount();
  });

  ipcMain.handle('stats:ventes-range', async (_evt, dateFrom, dateTo) => {
    return getVentesStatsByRange(dateFrom, dateTo);
  });

  ipcMain.handle('stats:receptions-range', async (_evt, dateFrom, dateTo) => {
    return getReceptionsStatsByRange(dateFrom, dateTo);
  });
}

module.exports = { 
  registerStatistiquesHandlers,
  getVentesStatsByRange,
  getReceptionsStatsByRange,
  getProduitsCount
};
