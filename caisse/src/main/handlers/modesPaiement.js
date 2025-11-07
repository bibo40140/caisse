// src/main/handlers/modesPaiement.js
'use strict';
const { ipcMain } = require('electron');
const db = require('../db/db');

function registerModesPaiementHandlers() {
  // table au cas où
  db.exec(`
    CREATE TABLE IF NOT EXISTS modes_paiement (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nom          TEXT UNIQUE NOT NULL,
      taux_percent REAL DEFAULT 0,
      frais_fixe   REAL DEFAULT 0,
      actif        INTEGER DEFAULT 1
    );
  `);

  const getAllStmt   = db.prepare(`SELECT id, nom, taux_percent, frais_fixe, actif FROM modes_paiement ORDER BY id ASC`);
  const insertStmt   = db.prepare(`INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif) VALUES (?, ?, ?, ?)`);
  const updateStmt   = db.prepare(`UPDATE modes_paiement SET nom=?, taux_percent=?, frais_fixe=?, actif=? WHERE id=?`);
  const deleteStmt   = db.prepare(`DELETE FROM modes_paiement WHERE id=?`);

  // API “officielle” utilisée par l’onglet Mon Compte
  ipcMain.handle('mp:getAll', () => getAllStmt.all());
  ipcMain.handle('mp:create', (_e, p) => {
    const nom  = (p?.nom || '').trim();
    const taux = Number(p?.taux_percent || 0);
    const fixe = Number(p?.frais_fixe || 0);
    const act  = (p?.actif ? 1 : 0);
    if (!nom) throw new Error('Nom obligatoire');
    const info = insertStmt.run(nom, taux, fixe, act);
    return { ok: true, id: info.lastInsertRowid };
  });
  ipcMain.handle('mp:update', (_e, p) => {
    const id   = Number(p?.id);
    const nom  = (p?.nom || '').trim();
    const taux = Number(p?.taux_percent || 0);
    const fixe = Number(p?.frais_fixe || 0);
    const act  = (p?.actif ? 1 : 0);
    if (!id || !nom) throw new Error('Id et nom obligatoires');
    updateStmt.run(nom, taux, fixe, act, id);
    return { ok: true };
  });
  ipcMain.handle('mp:remove', (_e, id) => {
    const n = Number(id);
    if (!n) throw new Error('Id invalide');
    deleteStmt.run(n);
    return { ok: true };
  });

  // (Facultatif) seed rapide si table vide
  try {
    const rows = getAllStmt.all();
    if (!rows || rows.length === 0) {
      insertStmt.run('Espèces', 0, 0, 1);
      insertStmt.run('CB', 0, 0, 1);
      try { insertStmt.run('Chèque', 0, 0, 0); } catch {}
      console.log('[modes_paiement] seed par défaut appliqué');
    }
  } catch (e) {
    console.warn('[modes_paiement] seed fail:', e?.message || e);
  }
}

module.exports = { registerModesPaiementHandlers };
