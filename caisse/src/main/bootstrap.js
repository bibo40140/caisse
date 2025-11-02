// src/main/bootstrap.js
'use strict';

const fetch = require('node-fetch');
const db = require('./db/db');
const { getApiBase, getAuthHeader } = require('./apiClient');

const BASE_FALLBACK = process.env.CAISSE_API_URL || 'http://localhost:3001';

function apiBase() {
  const b = (typeof getApiBase === 'function' ? getApiBase() : '') || BASE_FALLBACK;
  return String(b).replace(/\/+$/, '');
}

function authHeaders() {
  // getAuthHeader() -> { Authorization: 'Bearer ...' } or {}
  try {
    const h = typeof getAuthHeader === 'function' ? getAuthHeader() : {};
    return h && typeof h === 'object' ? h : {};
  } catch {
    return {};
  }
}

async function apiFetch(path, init = {}) {
  const base = apiBase();
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
    ...authHeaders(),
  };
  return fetch(url, { ...init, headers });
}

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

  // Ajout : modes de paiement pour être complet côté API
  let modes_paiement = [];
  try {
    modes_paiement = db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      ORDER BY id
    `).all();
  } catch { /* table peut ne pas exister, ce n'est pas bloquant */ }

  return { unites, familles, categories, adherents, fournisseurs, produits, modes_paiement };
}

async function runBootstrap() {
  // 1) Vérifier si nécessaire
  const check = await apiFetch('/sync/bootstrap_needed', { method: 'GET' });
  if (check.ok) {
    const j = await check.json().catch(() => null);
    if (j && j.ok && j.needed === false) {
      return { ok: true, skipped: true };
    }
  } else if (check.status === 401) {
    throw new Error(`bootstrap failed: 401 ${await check.text()}`);
  }

  // 2) Envoyer le référentiel complet
  const payload = readAll();
  const res = await apiFetch('/sync/bootstrap', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`bootstrap failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

module.exports = { runBootstrap };
