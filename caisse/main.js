// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const jwt = require('jsonwebtoken');

// === Auth & API config ===
const { ensureAuth, getConfig } = require('./src/main/config');
const { setApiBase, apiMainClient, setAuthToken, apiFetch, logout } = require('./src/main/apiClient');

// === App modules existants ===
const db = require('./src/main/db/db');
const { getDeviceId } = require('./src/main/device');
const { runBootstrap } = require('./src/main/bootstrap');
const sync = require('./src/main/sync'); // hydrateOnStartup, pullAll, pushOpsNow, startAutoSync

// --- cache local des infos d'auth (rempli au login / au startup)
const authCache = {
  token: null,
  role: null,
  is_super_admin: false,
  tenant_id: null,
  user_id: null,
};

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

// --- Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

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
  mainWin.once('ready-to-show', () => mainWin.show());
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

// Quit on all closed (except mac)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


function getTenantHeaders() {
  // Récupère le token déjà stocké par apiMainClient ou dans l’env
  let token = null;
  try {
    if (typeof apiMainClient?.getAuthToken === 'function') {
      token = apiMainClient.getAuthToken();
    }
  } catch {}
  if (!token && process.env.API_AUTH_TOKEN) token = process.env.API_AUTH_TOKEN;

  // Décode le JWT pour lire tenant_id
  const info = computeAuthInfoFromToken(token);
  const h = {};

  // Utiliser seulement un tenant_id valide (UUID)
  const isUUID = v => typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

  if (isUUID(info?.tenant_id)) {
    h['x-tenant-id'] = String(info.tenant_id);
  } else if (isUUID(process.env.TENANT_ID)) {
    // fallback uniquement si c’est un vrai UUID
    h['x-tenant-id'] = String(process.env.TENANT_ID);
  } // sinon: on n’envoie rien (l’API lira le tenant du token)

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

// Créer un tenant (réservé côté API au super admin)
ipcMain.handle('admin:registerTenant', async (_e, payload) => {
  try {
    const r = await apiFetch('/auth/register-tenant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.tenant_id) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true, tenant_id: js.tenant_id, token: js.token };
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

    setAuthToken(js.token);
    process.env.API_AUTH_TOKEN = js.token;

    // Enregistrer les handlers email juste après login
    ensureEmailHandlers();

    return { ok: true, token: js.token, role: js.role, is_super_admin: js.is_super_admin };
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
    let token = null;
    try {
      if (typeof apiMainClient?.getAuthToken === 'function') {
        token = apiMainClient.getAuthToken();
      }
    } catch (_) {}
    if (!token && process.env.API_AUTH_TOKEN) token = process.env.API_AUTH_TOKEN;

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

// Liste des tenants (réservé super admin côté API)
async function tryFetchTenantsMulti() {
  let custom = '';
  try {
    const cfg = getConfig();
    if (cfg && typeof cfg.tenants_endpoint === 'string' && cfg.tenants_endpoint.trim()) {
      custom = cfg.tenants_endpoint.trim();
      if (!custom.startsWith('/')) custom = '/' + custom;
    }
  } catch {}

  const candidates = [
    custom || null,
    '/tenants',
    '/admin/tenants',
    '/admin/tenants/list',
    '/tenant_settings/tenants',
    '/api/tenants',
    '/v1/tenants',
  ].filter(Boolean);

  for (const path of candidates) {
    let r;
    try {
      r = await apiFetch(path, { headers: { accept: 'application/json' } });
    } catch (e) { continue; }

    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (!ct.includes('application/json')) continue;

    let js;
    try { js = await r.json(); } catch { continue; }

    if (r.ok && Array.isArray(js?.tenants)) return { ok: true, tenants: js.tenants };
    if (r.ok && Array.isArray(js?.items))   return { ok: true, tenants: js.items };
    if (r.ok && Array.isArray(js?.data))    return { ok: true, tenants: js.data };
  }

  return { ok: false, error: 'Aucun endpoint JSON compatible pour la liste des tenants.' };
}

ipcMain.handle('admin:listTenants', async () => {
  try {
    const res = await tryFetchTenantsMulti();
    if (!res.ok) return res;
    return { ok: true, tenants: res.tenants };
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

ipcMain.handle('admin:tenant:email:test', async (_e, { tenantId, to, subject, text, html }) => {
  try {
    const r = await apiFetch('/mailer/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...getTenantHeadersFor(tenantId) },
      body: JSON.stringify({ to, subject, text, html }),
    });
    const js = await safeJson(r);
    if (!r.ok || !js?.ok) throw new Error(js?.error || `HTTP ${r.status}`);
    return { ok: true };
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

app.whenReady().then(async () => {
  console.log('[main] app ready — DEVICE_ID =', DEVICE_ID);

  // 1) Config → API base
  try {
    const cfg = await getConfig();
    if (cfg?.api_base_url) setApiBase(cfg.api_base_url);
  } catch (e) {
    console.warn('[config] lecture impossible:', e?.message || e);
  }

   // 🛑 Ajoute ceci pour empêcher tout auto-login via les variables d'env
  delete process.env.API_AUTH_TOKEN;
  delete process.env.TENANT_ID;

  // 2) Auth (token or login via config creds)
  let auth = { ok: false };
  try {
    auth = await ensureAuth();
  } catch (e) {
    console.error('[auth] ensureAuth error:', e?.message || e);
  }

  if (auth.ok && auth.token) {
    setAuthToken(auth.token);

    // remplir le cache d'emblée
    authCache.token = auth.token;
    const info = computeAuthInfoFromToken(auth.token);
    authCache.role = info.role;
    authCache.is_super_admin = info.is_super_admin;
    authCache.tenant_id = info.tenant_id;
    authCache.user_id = info.user_id;

    if (auth.tenant_id) process.env.TENANT_ID = auth.tenant_id;
    process.env.API_AUTH_TOKEN = auth.token;
    console.log('[auth] OK — tenant =', auth.tenant_id || '(inconnu)');

    ensureEmailHandlers(); // dès que l’auth auto est OK
  } else {
    console.warn('[auth] Pas de token API — on ouvre la fenêtre de login.');
    createLoginWindow();
    return;
  }

  // 3) Auto-sync
  try {
    sync.startAutoSync(DEVICE_ID);
  } catch (e) {
    console.warn('[sync] startAutoSync warning:', e?.message || e);
  }

  // 4) Bootstrap (local -> Neon) if allowed
  if (process.env.SKIP_BOOTSTRAP !== '1') {
    try {
      const r = await runBootstrap();
      console.log('[bootstrap] OK:', r);
    } catch (e) {
      console.error('[bootstrap] ERROR:', e?.message || e);
    }
  } else {
    console.log('[bootstrap] SKIPPED (env SKIP_BOOTSTRAP=1)');
  }

  // 5) Hydrate (Neon -> local) if allowed
  if (process.env.SKIP_HYDRATE !== '1') {
    try {
      const r = await sync.hydrateOnStartup();
      console.log('[hydrate] OK:', r);
    } catch (e) {
      console.error('[hydrate] ERROR:', e?.message || e);
    }
  } else {
    console.log('[hydrate] SKIPPED (env SKIP_HYDRATE=1)');
  }

  // 6) Route to Onboarding or Main
  try {
    const r = await apiFetch('/tenant_settings/onboarding_status', { headers: { accept: 'application/json' } });
    const js = await safeJson(r);

    ensureEmailHandlers(); // sécurité

    if (js.status?.onboarded) {
      createMainWindow();
    } else {
      createOnboardingWindow();
    }
  } catch {
    // API KO → on ouvre la main en mode local
    createMainWindow();
  }
});

// ---------------------------------
// IPC utilitaires + handlers existants
// ---------------------------------
function safeHandle(channel, handler) {
  try { ipcMain.removeHandler(channel); } catch (_) {}
  ipcMain.handle(channel, handler);
}

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
// (si tu as un vrai handler côté inventaire, on le remplacera — ici on renvoie juste une liste vide)
safeHandle('inventory:list-open', async () => {
  return { ok: true, items: [] };
});

// Handlers existants (inchangés)
require('./src/main/handlers/config')(ipcMain);
require('./src/main/handlers/produits');
require('./src/main/handlers/unites')(ipcMain);
require('./src/main/handlers/modules');
require('./src/main/handlers/carts');

const registerVentesHandlers = require('./src/main/handlers/ventes');
registerVentesHandlers(ipcMain);

const registerProspectsHandlers = require('./src/main/handlers/prospects');
registerProspectsHandlers(ipcMain);

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

if (cfgModules.fournisseurs) require('./src/main/handlers/fournisseurs')();
require('./src/main/handlers/adherents')(ipcMain);

if (cfgModules.cotisations) require('./src/main/handlers/cotisations');
if (cfgModules.imports !== false) require('./src/main/handlers/imports');
if (cfgModules.stocks) {
  require('./src/main/handlers/stock')(ipcMain);
}

const registerInventoryHandlers = require('./src/main/handlers/inventory');
registerInventoryHandlers(ipcMain);

// Fallbacks modes de paiement (inchangés)
function boolToInt(b) { return b ? 1 : 0; }
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS modes_paiement (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nom          TEXT UNIQUE NOT NULL,
      taux_percent REAL DEFAULT 0,
      frais_fixe   REAL DEFAULT 0,
      actif        INTEGER DEFAULT 1
    )
  `).run();
} catch (e) {
  console.error('[mp] create table error:', e?.message || e);
}

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
    if (!a.ok) return { ok: false, error: 'Non connecté (token manquant)' };
    if (typeof sync.pushOpsNow === 'function') {
      const r = await sync.pushOpsNow();
      return r || { ok: true };
    }
    return { ok: true }; // fallback si pas dispo
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

safeHandle('ops:pending-count', async () => {
  try {
    const fn =
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
