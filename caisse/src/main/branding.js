'use strict';

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

/* -----------------------------
   Helpers & emplacements
------------------------------ */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function baseBrandingDir() {
  const dir = path.join(app.getPath('userData'), 'branding');
  ensureDir(dir);
  return dir;
}

function logosDir() {
  const dir = path.join(baseBrandingDir(), 'logos');
  ensureDir(dir);
  return dir;
}

function tenantBrandJsonPath(tenantId) {
  const dir = path.join(baseBrandingDir(), 'tenants');
  ensureDir(dir);
  return path.join(dir, `brand-${tenantId}.json`);
}

function tenantLogoPath(tenantId) {
  return path.join(logosDir(), `tenant-${tenantId}.png`);
}

/* -----------------------------
   Tenant resolution
------------------------------ */
function tryDecodeTenantFromToken() {
  try {
    const tok = process.env.API_AUTH_TOKEN;
    if (!tok) return null;
    const payload = jwt.decode(tok) || {};
    const tid = payload.tenant_id || payload.tid || null;
    if (typeof tid === 'string' && tid.trim()) return tid.trim();
    return null;
  } catch {
    return null;
  }
}

function resolveTenantId(input) {
  // priorité à ce qui est fourni explicitement
  const wanted = (typeof input === 'string' && input.trim()) ? input.trim() : null;
  if (wanted && wanted !== 'default') return wanted;

  // sinon on tente depuis le JWT courant
  const fromToken = tryDecodeTenantFromToken();
  if (fromToken) return fromToken;

  // fallback (développement / cas extrême)
  return 'default';
}

/* -----------------------------
   IO JSON (par tenant)
------------------------------ */
function readTenantBrand(tenantId) {
  try {
    const p = tenantBrandJsonPath(tenantId);
    if (!fs.existsSync(p)) return {};
    const js = JSON.parse(fs.readFileSync(p, 'utf8'));
    return js || {};
  } catch {
    return {};
  }
}
function writeTenantBrand(tenantId, js) {
  const p = tenantBrandJsonPath(tenantId);
  fs.writeFileSync(p, JSON.stringify(js || {}, null, 2), 'utf8');
}

/* -----------------------------
   Utils
------------------------------ */
function saveDataUrlToPng(dataUrl, outPath) {
  const m = /^data:(image\/\w+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Logo invalide (dataURL attendu)');
  const buf = Buffer.from(m[2], 'base64');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, buf);
  return { mime: m[1], size: buf.length };
}

/* -----------------------------
   IPC Handlers (tenant-aware)
------------------------------ */
function registerBrandingIpc() {
  try { ipcMain.removeHandler('branding:get'); } catch {}
  try { ipcMain.removeHandler('branding:set'); } catch {}

  // GET (par tenant)
  ipcMain.handle('branding:get', async (_e, payload = {}) => {
    const tenantId = resolveTenantId(payload?.tenantId);

    const meta = readTenantBrand(tenantId); // { name? }
    const logoPath = tenantLogoPath(tenantId);

    let mtime = null;
    let file = null;
    if (fs.existsSync(logoPath)) {
      file = logoPath;
      try { mtime = fs.statSync(logoPath).mtimeMs; } catch {}
    }

    return {
      ok: true,
      tenantId,
      name: typeof meta.name === 'string' ? meta.name : null,
      logoFile: file, // compat
      file,
      mtime,
    };
  });

  // SET (par tenant)
  ipcMain.handle('branding:set', async (_e, payload = {}) => {
    // ⚠️ on résout TJS le tenantId (payload > JWT > default)
    const tenantId = resolveTenantId(payload?.tenantId);
    const { name, logoDataUrl, logoPath: srcLogoPath, deleteLogo } = payload || {};

    const meta = readTenantBrand(tenantId);
    if (typeof name === 'string') {
      meta.name = name.trim();
    }

    const out = tenantLogoPath(tenantId);
    let savedFile = null;
    let mtime = null;

    if (deleteLogo === true) {
      if (fs.existsSync(out)) {
        try { fs.unlinkSync(out); } catch {}
      }
      savedFile = null;
    } else if (logoDataUrl != null) {
      // dataURL fourni : si chaîne vide => suppression
      if (logoDataUrl && /^data:/i.test(logoDataUrl)) {
        saveDataUrlToPng(logoDataUrl, out);
        savedFile = out;
      } else {
        if (fs.existsSync(out)) { try { fs.unlinkSync(out); } catch {} }
        savedFile = null;
      }
    } else if (srcLogoPath && fs.existsSync(srcLogoPath)) {
      ensureDir(path.dirname(out));
      fs.copyFileSync(srcLogoPath, out);
      savedFile = out;
    }

    writeTenantBrand(tenantId, meta);

    if (savedFile && fs.existsSync(savedFile)) {
      try { mtime = fs.statSync(savedFile).mtimeMs; } catch {}
    }

    // 🔥 NOUVEAU: Sync vers l'API Neon (/tenant_settings/onboarding)
    try {
      const apiClient = require('./apiClient');
      const body = {};
      if (typeof meta.name === 'string' && meta.name.trim()) {
        body.company_name = meta.name.trim();
      }
      if (logoDataUrl && /^data:/i.test(logoDataUrl)) {
        body.logo_base64 = logoDataUrl;
      } else if (deleteLogo === true) {
        body.logo_base64 = '';
      }
      
      if (Object.keys(body).length > 0) {
        console.log('[branding:set] API base:', apiClient.getApiBase());
        console.log('[branding:set] Auth token present:', !!apiClient.getAuthToken());
        console.log('[branding:set] Calling API with body keys:', Object.keys(body));
        console.log('[branding:set] Body company_name:', body.company_name);
        console.log('[branding:set] Body logo_base64 length:', body.logo_base64?.length || 0);
        
        const response = await apiClient.post('/tenant_settings/onboarding', body);
        console.log('[branding:set] API response status:', response.status);
        console.log('[branding:set] API response URL:', response.url);
        
        if (!response.ok) {
          const text = await response.text();
          console.warn('[branding:set] API error:', response.status, text);
        } else {
          const result = await response.json();
          console.log('[branding:set] Synced to API successfully:', result);
        }
      }
    } catch (e) {
      console.error('[branding:set] Failed to sync to API:', e?.message || e);
      console.error('[branding:set] Full error:', e);
      // Non bloquant: on continue même si l'API échoue
    }

    return {
      ok: true,
      tenantId,
      name: typeof meta.name === 'string' ? meta.name : null,
      logoFile: savedFile || (fs.existsSync(out) ? out : null),
      file: savedFile || (fs.existsSync(out) ? out : null),
      mtime,
    };
  });
}

module.exports = { registerBrandingIpc };
