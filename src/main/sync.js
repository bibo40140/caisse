const fs = require('fs');
const path = require('path');
const { app } = require('electron');  // ⬅️ IMPORTANT
const db = require('./db/db');        // si pas déjà là



function readConfig() {
  // baseDir robuste (Electron main ou lancement direct)
  const baseDir =
    (app && typeof app.getAppPath === 'function')
      ? app.getAppPath()
      : path.resolve(__dirname, '../../..');

  const configPath = path.join(baseDir, 'config.json');
  console.log('[SYNC] Lecture config depuis :', configPath);

  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}



function ensureMirrorTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS produits_cloud_mirror (
      id TEXT PRIMARY KEY,
      code_barres TEXT UNIQUE,
      nom TEXT NOT NULL,
      prix REAL NOT NULL DEFAULT 0,
      categorie TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function apiLogin(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`Login API échoué: ${res.status}`);
  const json = await res.json();
  return json.token;
}

// PULL : Neon → table miroir locale
async function pullProduits() {
  const cfg = readConfig();
  const token = await apiLogin(cfg.api_base_url, cfg.api_email, cfg.api_password);

  const since = '1970-01-01T00:00:00Z';
  const res = await fetch(`${cfg.api_base_url}/sync/pull?since=${encodeURIComponent(since)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`pull échoué: ${res.status}`);
  const json = await res.json();
  const rows = (json?.data?.produits) || [];

  ensureMirrorTable();

  const upsert = db.prepare(`
    INSERT INTO produits_cloud_mirror (id, code_barres, nom, prix, categorie, updated_at)
    VALUES (@id, @code_barres, @nom, @prix, @categorie, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      code_barres = excluded.code_barres,
      nom         = excluded.nom,
      prix        = excluded.prix,
      categorie   = excluded.categorie,
      updated_at  = excluded.updated_at
  `);

  const txn = db.transaction(items => {
    for (const r of items) {
      upsert.run({
        id: String(r.id || ''),
        code_barres: r.code_barres || null,
        nom: r.nom || '',
        prix: Number(r.prix || 0),
        categorie: r.categorie || null,
        updated_at: r.updated_at || new Date().toISOString()
      });
    }
  });
  txn(rows);

  return { ok: true, count: rows.length };
}

// PUSH : ta table produits locale → Neon
async function pushProduits() {
  const cfg = readConfig();
  const token = await apiLogin(cfg.api_base_url, cfg.api_email, cfg.api_password);

  // On lit TA table produits actuelle (db.js la gère déjà)
  const produitsLocaux = db.prepare(`
    SELECT id, code_barre AS code_barres, nom, prix
  FROM produits
  `).all();

const payload = {
  changes: {
    produits: produitsLocaux.map(p => ({
      // pas d'id ici !
      code_barres: p.code_barres || p.code_barre || null,
      nom: p.nom || '',
      prix: Number(p.prix || 0),
      categorie: null, // on gèrera plus tard si besoin
      updated_at: new Date().toISOString()
    }))
  }
};


  const res = await fetch(`${cfg.api_base_url}/sync/push`, {
    method: 'POST',
    headers: { 'content-type':'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`push échoué: ${res.status}`);
  const json = await res.json();

  return { ok: true, applied: json.applied || 0 };
}

function registerSync(ipcMain) {
  ipcMain.handle('sync:pull-produits', async () => {
    try { return await pullProduits(); }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('sync:push-produits', async () => {
    try { return await pushProduits(); }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

module.exports = { registerSync };
