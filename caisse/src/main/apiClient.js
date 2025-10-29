// src/main/apiClient.js
'use strict';

const fetch = require('node-fetch');

let API_BASE = (process.env.CAISSE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
let AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';

function setApiBase(url) {
  if (!url) return;
  API_BASE = String(url).replace(/\/+$/, '');
}
function getApiBase() {
  return API_BASE;
}

function setAuthToken(token) {
  AUTH_TOKEN = token || '';
  // garde une copie pour d’anciens modules qui lisent process.env
  if (AUTH_TOKEN) process.env.API_AUTH_TOKEN = AUTH_TOKEN;
}
function getAuthToken() {
  return AUTH_TOKEN || process.env.API_AUTH_TOKEN || '';
}
function getAuthHeader() {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiFetch(path, init = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
    ...getAuthHeader(),
  };
  return fetch(url, { ...init, headers });
}

function logout() {
  AUTH_TOKEN = null;
}

module.exports = {
  setApiBase,
  getApiBase,
  setAuthToken,
  getAuthToken,
  getAuthHeader,
  apiFetch,
  logout
};
