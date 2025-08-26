const fetch = require('node-fetch');
const db = require('./db/db');

const API_URL = process.env.CAISSE_API_URL || 'http://localhost:3001';

function readAll() {
  const unites       = db.prepare(`SELECT id, nom FROM unites`).all();
  const familles     = db.prepare(`SELECT id, nom FROM familles`).all();
  const categories   = db.prepare(`SELECT id, nom, famille_id FROM categories`).all();
  const adherents    = db.prepare(`SELECT * FROM adherents`).all();
  const fournisseurs = db.prepare(`SELECT * FROM fournisseurs`).all();
  const produits     = db.prepare(`
    SELECT id, nom, reference, prix, stock, code_barre, unite_id, fournisseur_id, categorie_id
    FROM produits
  `).all();
  return { unites, familles, categories, adherents, fournisseurs, produits };
}

// dans src/main/bootstrap.js
async function runBootstrap() {
  const check = await fetch(`${API_URL}/sync/bootstrap_needed`);
  if (check.ok) {
    const j = await check.json();
    if (j.ok && j.needed === false) return { ok: true, skipped: true };
  }
  const payload = readAll(); // comme déjà fait
  const res = await fetch(`${API_URL}/sync/bootstrap`, {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { runBootstrap };
