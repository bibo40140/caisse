// main.js

const { resetCache: resetConfigCache, readConfig, removeAuthToken, scrubSecrets } = require('./src/main/db/config');

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const jwt = require('jsonwebtoken');

// ✅ On centralise l’IPC branding dans src/main/branding.js
const { registerBrandingIpc } = require('./src/main/branding');

const registerSyncDebug = require('./src/main/handlers/sync_debug');
registerSyncDebug(ipcMain);


// ===============================
// Broadcast config/modules to UI
// ===============================

// ➜ Helper: calcule une config "effective" (disque + runtime + ENV + défaut)
function getEffectiveConfig() {
  let disk = {};
  try {
    disk = readConfig() || {};
  } catch { disk = {}; }

  // On tente de récupérer l’API base depuis l’apiClient
  let apiBase = null;
  try {
    const { getApiBase } = require('./src/main/apiClient');
    apiBase = getApiBase && getApiBase();
  } catch {}

  // Fallback ENV puis valeur par défaut locale
  if (!apiBase || typeof apiBase !== 'string' || !apiBase.trim()) {
    apiBase = process.env.API_BASE_URL || disk.api_base_url || 'http://localhost:3001';
  }

  return {
    ...disk,
    api_base_url: apiBase,
  };
}

function broadcastConfigOnReady() {
  try {
    const cfgEffective = getEffectiveConfig();
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('config:changed', cfgEffective); } catch {}
    });
  } catch (e) {
    console.error('[broadcastConfigOnReady] failed:', e?.message || e);
  }
}

// === Auth & API config ===
const { ensureAuth, getConfig, setConfig } = require('./src/main/config');
const { setApiBase, getApiBase, setAuthToken, getAuthToken, apiFetch, logout } = require('./src/main/apiClient');

// === App modules existants ===
const db = require('./src/main/db/db');
const { ensureLocalSchema } = require('./src/main/db/schema');
ensureLocalSchema(db);

const { getDeviceId } = require('./src/main/device');
const sync = require('./src/main/sync'); // hydrateOnStartup, pullAll, pushOpsNow, startAutoSync


ipcMain.handle('sync:hydrateOnStartup', async () => {
  try {
    const r = await sync.hydrateOnStartup();
    return { ok: true, result: r };
  } catch (e) {
    console.error('hydrateOnStartup IPC error:', e);
    return { ok: false, error: String(e) };
  }
});

// --- cache local des infos d'auth (rempli au login / au startup)
const authCache = {
  token: null,
  role: null,
  is_super_admin: false,
  tenant_id: null,
  user_id: null,
};

// ❌ SUPPRIMÉ : re-déclaration de readConfig/writeConfig et tout le code "branding:*" inline
//   -> on utilise maintenant exclusivement src/main/branding.js

function computeAuthInfoFromToken(token) {
  if (!token) return { role: 'user', is_super_admin: false, tenant_id: null, user_id: null, email: null };
  try {
    const payload = jwt.decode(token) || {};
    const role = payload.role || 'user';
    const isSuper = !!payload.is_super_admin || role === 'super_admin';
    return {
      role,
      is_super_admin: isSuper,
      tenant_id: payload.tenant_id ?? null,
      user_id: payload.user_id ?? payload.sub ?? null,
      email: payload.email ?? null,
      _raw: payload,
    };
  } catch {
    return { role: 'user', is_super_admin: false, tenant_id: null, user_id: null, email: null };
  }
}

// --- Single instance lock DISABLED for multi-instance testing
// Each instance uses its own DATA_DIR and DEVICE_ID via environment variables
// const gotTheLock = app.requestSingleInstanceLock();
// if (!gotTheLock) {
//   app.quit();
// }

// ---------------------------
// Windows (only these three)
// ---------------------------
let mainWin = null;
let loginWin = null;
let onboardWin = null;

function createMainWindow() {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true,
    },
  });
  mainWin.maximize();
  mainWin.loadFile('index.html');
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    // broadcast modules tout de suite après affichage
    setTimeout(broadcastConfigOnReady, 150);
  });
  // sécurité: si la page recharge, on renvoie la config
  mainWin.webContents.on('did-finish-load', () => setTimeout(broadcastConfigOnReady, 50));
  mainWin.on('closed', () => { mainWin = null; });
}

function createLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    if (loginWin.isMinimized()) loginWin.restore();
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 420, height: 420, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true,
    },
  });
  loginWin.loadFile('src/renderer/login.html');
  loginWin.once('ready-to-show', () => {
    setTimeout(broadcastConfigOnReady, 150);
  });
  loginWin.webContents.on('did-finish-load', () => setTimeout(broadcastConfigOnReady, 50));
  loginWin.on('closed', () => { loginWin = null; });
}

function createOnboardingWindow() {
  if (onboardWin && !onboardWin.isDestroyed()) {
    if (onboardWin.isMinimized()) onboardWin.restore();
    onboardWin.focus();
    return;
  }
  onboardWin = new BrowserWindow({
    width: 640, height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload.js'),
      contextIsolation: true,
    },
  });
  onboardWin.loadFile('src/renderer/onboarding.html');
  onboardWin.once('ready-to-show', () => {
    setTimeout(broadcastConfigOnReady, 150);
  });
  onboardWin.webContents.on('did-finish-load', () => setTimeout(broadcastConfigOnReady, 50));
  onboardWin.on('closed', () => { onboardWin = null; });
}

// Second instance: focus any existing window (don’t create a new one)
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  } else {
    createLoginWindow();
  }
});

// macOS: re-open a window if none
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createLoginWindow();
  }
});

// Broadcast config on any new window creation (sécurise les cas de navigation interne)
app.on('browser-window-created', () => {
  setTimeout(broadcastConfigOnReady, 150);
});

// Quit on all closed (except mac)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function getTenantHeaders() {
  // Récupère le token déjà stocké par apiClient
  let token = getAuthToken && getAuthToken();

  // Décode le JWT pour lire tenant_id
  const info = computeAuthInfoFromToken(token);
  const h = {};

  // Utiliser seulement un tenant_id valide (UUID)
  const isUUID = v => typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  if (isUUID(info?.tenant_id)) {
    h['x-tenant-id'] = String(info.tenant_id);
  } else if (isUUID(process.env.TENANT_ID)) {
    h['x-tenant-id'] = String(process.env.TENANT_ID);
  }
  return h;
}

function getTenantHeadersFor(tenantId) {
  const h = {};
  if (tenantId) h['x-tenant-id'] = String(tenantId);
  return h;
}

// ---------------------------------
// Helpers fetch JSON sûrs
// ---------------------------------
async function safeJson(r) {
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await r.text().catch(() => '');
    throw new Error(`Réponse non-JSON (${r.status}). Corps: ${text.slice(0, 120)}`);
  }
  return r.json();
}

// ---------------------------------
// IPC: Auth / Onboarding flow
// ---------------------------------

// ✅ Créer un tenant (correct)
const authState = require('./src/main/auth/state'); // adapte le chemin si besoin

ipcMain.handle('admin:registerTenant', async (_e, payload) => {
  try {
    const { tenant_name, email, password, company_name, logo_url } = payload || {};

    const r = await apiFetch('/auth/register-tenant', {
      method: 'POST',
      body: JSON.stringify({
        tenant_name,
        email,
        password,
        company_name: company_name || tenant_name,
        logo_url: logo_url || null,
      }),
    });

    // on évite safeJson ici: on veut lever une erreur claire si non-JSON
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${body || 'register failed'}`);
    }
    const js = await r.json();

    // stocker le token en mémoire (et dans ton state)
    setAuthToken(js.token);
    if (authState && typeof authState.set === 'function') {
      authState.set({
        token: js.token,
        tenant_id: js.tenant_id,
        role: js.role,
        is_super_admin: !!js.is_super_admin,
      });
    }

    return { ok: true, tenant_id: js.tenant_id, token: js.token, role: js.role, is_super_admin: !!js.is_super_admin };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});


// Login
ipcMain.handle('auth:login', async (_e, { email, password }) => {
  try {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.token) return { ok: false, error: js?.error || `HTTP ${r.status}` };

    // 1) mémorise en mémoire/process
    setAuthToken(js.token);
    process.env.API_AUTH_TOKEN = js.token;

    // 1b) 🔥 Extraire tenant_id du JWT et activer la bonne base locale
    const authInfo = computeAuthInfoFromToken(js.token);
    if (authInfo.tenant_id) {
      const { setActiveTenantId } = require('./src/main/db/tenantDb');
      setActiveTenantId(authInfo.tenant_id);
      console.log('[auth:login] tenant_id activé:', authInfo.tenant_id);
    }

    // 2) PERSISTE dans config.json pour les futures actions (push/pull/ensureAuth)
    try {
      const { setConfig } = require('./src/main/config');  // ← on utilise le même module que ensureAuth()
      // 🔥 on stocke aussi le dernier email pour pré-remplir le login
      setConfig({ auth_token: js.token, last_email: email });
    } catch (e) {
      console.warn('[auth:login] impossible d’écrire auth_token/last_email dans config.json:', e?.message || e);
    }

    // 3) email handlers
    ensureEmailHandlers();

    // 4) 🆕 Auto-import des références serveur si la base locale est vide
    try {
      const { isLocalDbEmpty, importServerRefsToLocal } = require('./src/main/importServerRefs');
      if (isLocalDbEmpty()) {
        console.log('[auth:login] Base locale vide, import automatique des catégories/unités/modes depuis serveur...');
        const importResult = await importServerRefsToLocal();
        if (importResult.ok) {
          console.log('[auth:login] Import auto terminé:', importResult.counts);
        } else {
          console.warn('[auth:login] Import auto échoué:', importResult.error);
        }
      }
    } catch (e) {
      console.warn('[auth:login] Auto-import failed (non-bloquant):', e?.message || e);
    }

    // 5) 🆕 Push initial des opérations en attente (produits créés hors ligne)
    try {
      console.log('[auth:login] Push initial des opérations en attente...');
      const pushResult = await sync.pushOpsNow(process.env.DEVICE_ID || 'default');
      if (pushResult?.ok) {
        console.log('[auth:login] Push initial terminé:', pushResult.sent, 'opérations envoyées');
      }
    } catch (e) {
      console.warn('[auth:login] Push initial échoué (non-bloquant):', e?.message || e);
    }

    // 6) 🆕 Pull complet après login pour synchroniser produits/ventes/réceptions
    try {
      console.log('[auth:login] Pull automatique des données depuis serveur...');
      const pullResult = await sync.pullRefs();
      if (pullResult?.ok) {
        console.log('[auth:login] Pull auto terminé');
      }
    } catch (e) {
      console.warn('[auth:login] Pull auto échoué (non-bloquant):', e?.message || e);
    }

    // 7) 🆕 Démarrer l'auto-sync (push + pull périodiques)
    try {
      sync.startAutoSync(process.env.DEVICE_ID || 'default');
      console.log('[auth:login] Auto-sync démarré (push toutes les 5s, pull toutes les 10s)');
    } catch (e) {
      console.warn('[auth:login] Erreur démarrage auto-sync:', e?.message || e);
    }

    return { ok: true, token: js.token, role: js.role, is_super_admin: js.is_super_admin };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 🔥 NOUVEAU : pour pré-remplir le login (email + tenant info éventuelle)
ipcMain.handle('auth:getSavedAuth', async () => {
  try {
    const cfg = await getConfig();
    const email = cfg?.last_email || null;
    const token = cfg?.auth_token || null;

    let tenant_id = null;
    if (token) {
      const info = computeAuthInfoFromToken(token);
      tenant_id = info.tenant_id;
    }

    return { ok: true, email, tenant_id };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ⇢ NOUVEAU: handler demandé par le renderer pour “assurer” l’auth
ipcMain.handle('auth:ensure', async () => {
  try {
    const res = await ensureAuth();
    if (res?.ok && res.token) {
      setAuthToken(res.token);
      process.env.API_AUTH_TOKEN = res.token;

      // garder en cache
      authCache.token = res.token;
      const info = computeAuthInfoFromToken(res.token);
      authCache.role = info.role;
      authCache.is_super_admin = info.is_super_admin;
      authCache.tenant_id = info.tenant_id;
      authCache.user_id = info.user_id;
    }
    return res;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Après login : route vers onboarding/main
ipcMain.handle('auth:after-login-route', async () => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status', {
      headers: { 'accept': 'application/json' }
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    const onboarded = !!js.status?.onboarded;

    // Sécurité: s’assurer que les handlers email sont bien là
    ensureEmailHandlers();

    if (!onboarded) {
      if (loginWin) { loginWin.close(); loginWin = null; }
      createOnboardingWindow();
      return { ok: true, next: 'onboarding' };
    } else {
      if (loginWin) { loginWin.close(); loginWin = null; }
      createMainWindow();
      return { ok: true, next: 'main' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ⇢ retourne { ok, role, is_super_admin, tenant_id, user_id }
ipcMain.handle('auth:getInfo', async () => {
  try {
    const token = getAuthToken && getAuthToken();
    if (!token) return { ok: false, error: 'no token' };

    const payload = jwt.decode(token) || {};
    const role = payload.role || 'user';
    const isSuper = !!payload.is_super_admin || role === 'super_admin';

    return {
      ok: true,
      role,
      is_super_admin: isSuper,
      tenant_id: payload.tenant_id ?? null,
      user_id: payload.user_id ?? payload.sub ?? null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// --- Liste des tenants (endpoint direct + fallback)
async function tryListTenants() {
  // 1) endpoint “officiel”
  try {
    const r = await apiFetch('/tenants/admin/list', { headers: { accept: 'application/json' }});
    const js = await safeJson(r);
    if (r.ok && (Array.isArray(js?.tenants) || Array.isArray(js?.items) || Array.isArray(js?.data))) {
      const tenants = js.tenants || js.items || js.data;
      return { ok: true, tenants };
    }
  } catch {}

  // 2) fallback heuristique (multi points)
  const candidates = [
    '/tenants',
    '/admin/tenants',
    '/admin/tenants/list',
    '/tenant_settings/tenants',
    '/api/tenants',
    '/v1/tenants',
  ];
  for (const path of candidates) {
    try {
      const r = await apiFetch(path, { headers: { accept: 'application/json' } });
      const js = await safeJson(r);
      if (r.ok && Array.isArray(js?.tenants)) return { ok: true, tenants: js.tenants };
      if (r.ok && Array.isArray(js?.items))   return { ok: true, tenants: js.items };
      if (r.ok && Array.isArray(js?.data))    return { ok: true, tenants: js.data };
    } catch {}
  }
  return { ok: false, error: 'Aucun endpoint JSON compatible pour la liste des tenants.' };
}

ipcMain.handle('admin:listTenants', async () => {
  try {
    return await tryListTenants();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('onboarding:status', async () => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status', { headers: { accept: 'application/json' } });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, ...js };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('onboarding:submit', async (_e, payload) => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Déconnexion : purge token, ferme app, rouvre login
ipcMain.handle('auth:logout', async () => {
  try {
    logout();

    // Purge disque & env → évite l’auto-login au prochain démarrage
    try { removeAuthToken && removeAuthToken(); } catch {}
    try { resetConfigOnLogout(); } catch {}

    try {
      const { resetCache } = require('./src/main/db/tenantDb');
      resetCache();
    } catch {}

    // purge cache
    authCache.token = null;
    authCache.role = null;
    authCache.is_super_admin = false;
    authCache.tenant_id = null;
    authCache.user_id = null;

    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.close(); } catch {} mainWin = null; }
    if (onboardWin && !onboardWin.isDestroyed()) { try { onboardWin.close(); } catch {} onboardWin = null; }

    createLoginWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// petite aide: centralise purge env+cache config
function resetConfigOnLogout() {
  try { resetConfigCache(); } catch {}
  delete process.env.API_AUTH_TOKEN;
  delete process.env.TENANT_ID;
}

// ✅ Enregistre UNE FOIS les handlers branding (idempotent dans branding.js)
registerBrandingIpc();

ipcMain.handle('app:go-main', async () => {
  ensureEmailHandlers();
  if (onboardWin) { onboardWin.close(); onboardWin = null; }
  createMainWindow();
  return { ok: true };
});

// Lire/écrire les modules du tenant (via API onboarding)
ipcMain.handle('tenant:modules:get', async () => {
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status', {
      headers: { accept: 'application/json', ...getTenantHeaders() }
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    const modules = js?.status?.modules || {};
    return { ok: true, modules };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('tenant:modules:set', async (_e, modules) => {
  try {
    const payload = { modules: modules || {} };
    const r = await apiFetch('/tenant_settings/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...getTenantHeaders() },
      body: JSON.stringify(payload),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);

    try {
      const { writeModules } = require('./src/main/db/config');
      writeModules(payload.modules || {});
    } catch {}
    // Broadcast immédiat après sauvegarde
    setTimeout(broadcastConfigOnReady, 50);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// --- ADMIN: Modules d'un tenant ciblé ---
ipcMain.handle('admin:tenant:modules:get', async (_e, tenantId) => {
  try {
    const r = await apiFetch('/tenant_settings/modules', {
      headers: { accept: 'application/json', ...getTenantHeadersFor(tenantId) }
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, modules: js.modules || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('admin:tenant:modules:set', async (_e, { tenantId, modules }) => {
  try {
    const r = await apiFetch('/tenant_settings/modules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...getTenantHeadersFor(tenantId) },
      body: JSON.stringify(modules || {}),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, modules: js.modules || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// --- ADMIN: Email d'un tenant ciblé ---
// GET email settings
ipcMain.handle('admin:tenant:email:get', async (_e, tenantId) => {
  try {
    const r = await apiFetch('/tenant_settings/email', {
      headers: { accept: 'application/json', ...getTenantHeadersFor(tenantId) }
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, settings: js.settings || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// PUT email settings (⚠️ PUT, pas POST)
ipcMain.handle('admin:tenant:email:set', async (_e, { tenantId, settings }) => {
  try {
    const r = await apiFetch('/tenant_settings/email', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...getTenantHeadersFor(tenantId) },
      body: JSON.stringify(settings || {}),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, settings: js.settings || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// --- ADMIN: suppression d'un tenant (soft delete par défaut, hard avec { hard: true })
ipcMain.handle('admin:tenant:delete', async (_e, { tenantId, hard = false }) => {
  try {
    const url = `/tenants/${encodeURIComponent(String(tenantId))}${hard ? '?hard=1' : ''}`;
    const r = await apiFetch(url, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, hard: !!hard };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ---------------------------------
// Single startup flow (ONLY ONE)
// ---------------------------------
const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

function purgeLocalAuth() {
  try { removeAuthToken && removeAuthToken(); } catch {}
  try { resetConfigOnLogout(); } catch {}
  try {
    const { setConfig } = require('./src/main/config');
    if (typeof setConfig === 'function') {
      // On ne touche qu'au token, on laisse le reste (modules, last_email, etc.)
      setConfig({ auth_token: null });
    }
  } catch (e) {
    console.warn('[auth] purgeLocalAuth setConfig failed:', e?.message || e);
  }

  delete process.env.API_AUTH_TOKEN;
  delete process.env.TENANT_ID;
}


app.whenReady().then(async () => {
  console.log('[main] app ready — DEVICE_ID =', DEVICE_ID);

  // 1) Config → API base (avec fallback ENV/localhost)
  try {
    const { getConfig } = require('./src/main/config');
    const cfg = await getConfig();
    const fromCfg = cfg?.api_base_url && String(cfg.api_base_url).trim();
    const fallback = process.env.API_BASE_URL || 'http://localhost:3001';
    setApiBase(fromCfg || fallback);
  } catch (e) {
    const fallback = process.env.API_BASE_URL || 'http://localhost:3001';
    setApiBase(fallback);
    console.warn('[config] lecture impossible, fallback API_BASE_URL =', fallback, '-', e?.message || e);
  }

  // 2) 🔥 POUR L’INSTANT : on désactive complètement l’auto-auth
  //    → on purge tout token éventuellement présent
  //    → on ouvre DIRECTEMENT la fenêtre de login
  console.warn('[startup] AUTO-AUTH désactivée → purge token + ouverture écran de login.');
  try { purgeLocalAuth(); } catch {}

  createLoginWindow();
});





const registerAdherentsHandlers = require('./src/main/handlers/adherents');
registerAdherentsHandlers(); 

// --- garde-fou pour handlers email
let _emailHandlersRegistered = false;
function ensureEmailHandlers() {
  if (_emailHandlersRegistered) return;
  try {
    const registerEmailHandlers = require('./src/main/handlers/email');
    registerEmailHandlers();
    _emailHandlersRegistered = true;
    console.log('[main] email handlers registered');
  } catch (e) {
    // Ne pas faire planter l’app si le module n’existe pas encore
    console.error('[main] email handlers registration failed:', e?.message || e);
  }
}

// ---------------------------------
// IPC utilitaires + handlers existants
// ---------------------------------
function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

// ⚠️ IMPORTANT : on (re)définit config:get pour renvoyer la config EFFECTIVE (avec api_base_url garanti)
safeHandle('config:get', async () => {
  try {
    return getEffectiveConfig();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 🔧🔧 🔥 AJOUTS POUR LA PAGE SYNCHRO (état & déclenchement file d’attente) 🔥 🔧🔧
safeHandle('sync:status', async () => {
  try {
    const n = (typeof sync.countPendingOps === 'function') ? sync.countPendingOps() : 0;
    return { ok: true, queue: Number(n || 0), when: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), queue: 0 };
  }
});

safeHandle('sync:drain', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    const r = await sync.pushOpsNow(DEVICE_ID);
    return r?.ok ? r : { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});


// Handlers Sync principaux
safeHandle('sync:pushBootstrapRefs', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.pushBootstrapRefs();
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

safeHandle('sync:push_all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.syncPushAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('sync:pull_all', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    return await sync.pullAll();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ⚠️ NOUVEAU: fallback pour éviter l’erreur "No handler registered for 'inventory:list-open'"


safeHandle('sync:pull_ventes', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connect� (token manquant)' };
    return await sync.pullVentes();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('sync:pull_receptions', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connect� (token manquant)' };
    return await sync.pullReceptions();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
safeHandle('inventory:list-open', async () => {
  return { ok: true, items: [] };
});

// ⚠️⚠️ NOUVEAU — Historique Inventaires (routes API protégées) ⚠️⚠️
safeHandle('inventory:listSessions', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };

    const r = await apiFetch('/inventory/sessions', {
      headers: { accept: 'application/json', ...getTenantHeaders() }
    });
    const js = await safeJson(r);
    if (!r.ok) throw new Error(js?.error || `HTTP ${r.status}`);

    // Tolérer différents schémas de payload
    const items = Array.isArray(js?.items) ? js.items
                : Array.isArray(js?.sessions) ? js.sessions
                : Array.isArray(js?.data) ? js.data
                : [];
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('inventory:getSummary', async (_e, sessionId) => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    const id = encodeURIComponent(String(sessionId));

    const r = await apiFetch(`/inventory/${id}/summary`, {
      headers: { accept: 'application/json', ...getTenantHeaders() }
    });
    const js = await safeJson(r);
    if (!r.ok) throw new Error(js?.error || `HTTP ${r.status}`);

    // payload flexible
    const summary = js?.summary ?? js;
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Handlers existants (inchangés)
require('./src/main/handlers/config')(ipcMain);
require('./src/main/handlers/unites')(ipcMain);
const registerModulesHandlers = require('./src/main/handlers/modules');
registerModulesHandlers(); // <<< enregistre 'get-modules', 'set-modules', 'modules:save'

require('./src/main/handlers/carts');

const registerVentesHandlers = require('./src/main/handlers/ventes');
registerVentesHandlers(ipcMain);

const registerProspectsHandlers = require('./src/main/handlers/prospects');
registerProspectsHandlers(ipcMain);

const { registerModesPaiementHandlers } = require('./src/main/handlers/modesPaiement');
registerModesPaiementHandlers();


const { registerCategoryHandlers } = require('./src/main/handlers/categories');
registerCategoryHandlers();

const registerFournisseurHandlers = require('./src/main/handlers/fournisseurs');
registerFournisseurHandlers();

const registerProduitHandlers = require('./src/main/handlers/produits');
registerProduitHandlers(ipcMain);

const { registerReceptionHandlers } = require('./src/main/handlers/receptions');
registerReceptionHandlers(ipcMain);

const registerCotisationsHandlers = require('./src/main/handlers/cotisations');
registerCotisationsHandlers();

// chargements conditionnels (synchrone)
let cfgModules = {};
try {
  const c = getConfig(); // si getConfig est async chez toi, évite l’appel sync
  cfgModules = (c && c.modules) || {};
} catch { cfgModules = {}; }

if (cfgModules.cotisations) require('./src/main/handlers/cotisations');
if (cfgModules.imports !== false) require('./src/main/handlers/imports');
if (cfgModules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
}

const registerInventoryHandlers = require('./src/main/handlers/inventory');
registerInventoryHandlers(ipcMain);

const { registerStatistiquesHandlers } = require('./src/main/handlers/statistiques');
registerStatistiquesHandlers(ipcMain);

// Fallbacks modes de paiement (inchangés)
function boolToInt(b) { return b ? 1 : 0; }

try { ipcMain.removeHandler('mp:getAll'); } catch {}
try { ipcMain.removeHandler('mp:getAllAdmin'); } catch {}
try { ipcMain.removeHandler('mp:create'); } catch {}
try { ipcMain.removeHandler('mp:update'); } catch {}
try { ipcMain.removeHandler('mp:remove'); } catch {}

safeHandle('mp:getAll', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      WHERE actif = 1
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:getAllAdmin', async () => {
  try {
    return db.prepare(`
      SELECT id, nom, taux_percent, frais_fixe, actif
      FROM modes_paiement
      ORDER BY nom COLLATE NOCASE
    `).all();
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:create', async (_e, payload) => {
  try {
    const nom  = String(payload?.nom || '').trim();
    const taux = Number(payload?.taux_percent || 0);
    const fixe = Number(payload?.frais_fixe || 0);
    const actif = boolToInt(!!payload?.actif);
    if (!nom) throw new Error('Nom requis');
    const r = db.prepare(`
      INSERT INTO modes_paiement (nom, taux_percent, frais_fixe, actif)
      VALUES (?, ?, ?, ?)
    `).run(nom, taux, fixe, actif);
    return { id: r.lastInsertRowid, nom, taux_percent: taux, frais_fixe: fixe, actif: !!actif };
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:update', async (_e, payload) => {
  try {
    const id   = Number(payload?.id);
    const nom  = String(payload?.nom || '').trim();
    const taux = Number(payload?.taux_percent || 0);
    const fixe = Number(payload?.frais_fixe || 0);
    const actif = boolToInt(!!payload?.actif);
    if (!id) throw new Error('ID requis');
    if (!nom) throw new Error('Nom requis');
    db.prepare(`
      UPDATE modes_paiement
      SET nom = ?, taux_percent = ?, frais_fixe = ?, actif = ?
      WHERE id = ?
    `).run(nom, taux, fixe, actif, id);
    return { id, nom, taux_percent: taux, frais_fixe: fixe, actif: !!actif };
  } catch (e) { throw new Error(e?.message || String(e)); }
});

safeHandle('mp:remove', async (_e, id) => {
  try {
    const n = Number(id);
    if (!n) throw new Error('ID requis');
    db.prepare(`DELETE FROM modes_paiement WHERE id = ?`).run(n);
    return { ok: true };
  } catch (e) { throw new Error(e?.message || String(e)); }
});

// --- Ops (pour le chip en haut à droite)
safeHandle('ops:push-now', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) {
      return { ok: false, error: 'Non connecté (token manquant)' };
    }

    if (typeof sync.pushOpsNow === 'function') {
      const r = await sync.pushOpsNow(DEVICE_ID);  // ✅ on passe bien le deviceId
      return r || { ok: true };
    }

    return { ok: true }; // fallback si la fonction n'existe pas
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});


safeHandle('ops:pending-count', async () => {
  try {
    const fn =
      sync?.countPendingOps || // ✅ correction : utiliser le bon export
      sync?.opsPendingCount || sync?.pendingOpsCount || sync?.getPendingOpsCount;
    if (typeof fn === 'function') {
      const n = await fn();
      return { ok: true, count: Number(n || 0) };
    }
    return { ok: true, count: 0 };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), count: 0 };
  }
});

safeHandle('sync:retry_failed', async (_evt, ids) => {
  try {
    if (!sync?.retryFailedOps) {
      return { ok: false, error: 'retryFailedOps non disponible' };
    }
    return await sync.retryFailedOps(ids);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ═══════════════════════════════════════════════════════════
//  HANDLERS LOGS & DIAGNOSTIC
// ═══════════════════════════════════════════════════════════

const logger = require('./src/main/logger');

safeHandle('logs:getRecent', async (_evt, options) => {
  try {
    const { limit = 100, filters = {} } = options || {};
    const logs = logger.getRecentLogs(limit, filters);
    return { ok: true, logs };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('logs:export', async () => {
  try {
    const filePath = logger.exportLogs();
    if (filePath) {
      return { ok: true, filePath };
    } else {
      return { ok: false, error: 'Échec export logs' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('logs:clear', async () => {
  try {
    const success = logger.clearLogs();
    return { ok: success };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('diagnostic:export', async () => {
  try {
    const result = logger.exportDiagnostic(db);
    return result;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// ═══════════════════════════════════════════════════════════
//  EMAIL ADMIN HANDLERS (par tenant)
// ═══════════════════════════════════════════════════════════

safeHandle('emailAdmin:getSettings', async () => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };

    const r = await apiFetch('/tenant_settings/email_admin', {
      headers: { accept: 'application/json', ...getTenantHeaders() }
    });
    const js = await safeJson(r);
    if (!r.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, settings: js.settings || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('emailAdmin:setSettings', async (_evt, settings) => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };

    const r = await apiFetch('/tenant_settings/email_admin', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getTenantHeaders()
      },
      body: JSON.stringify(settings || {})
    });
    const js = await safeJson(r);
    if (!r.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, settings: js.settings || {} };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('emailAdmin:testSend', async (_evt, payload) => {
  try {
    const a = await ensureAuth();
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };

    const { to, subject = '[Test] Coopaz', text = 'Email de test' } = payload || {};
    if (!to) return { ok: false, error: 'Destinataire requis' };

    const r = await apiFetch('/tenant_settings/email/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getTenantHeaders()
      },
      body: JSON.stringify({ to, subject, text })
    });
    const js = await safeJson(r);
    if (!r.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
