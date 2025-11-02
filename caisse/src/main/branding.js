'use strict';

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

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
  // 1 json par tenant
  const dir = path.join(baseBrandingDir(), 'tenants');
  ensureDir(dir);
  return path.join(dir, `brand-${tenantId}.json`);
}

function tenantLogoPath(tenantId) {
  // 1 fichier logo par tenant
  return path.join(logosDir(), `tenant-${tenantId}.png`);
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
  } catch (_) {
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
    const tenantId = String(payload?.tenantId || 'default');

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
      name: meta.name || null,
      logoFile: file,   // conservé pour compat Renderer
      file,             // alias
      mtime
    };
  });

  // SET (par tenant)
  ipcMain.handle('branding:set', async (_e, payload = {}) => {
    const tenantId = String(payload?.tenantId || 'default');
    const { name, logoDataUrl, logoPath: srcLogoPath } = payload;

    const meta = readTenantBrand(tenantId);

    // MAJ nom si fourni
    if (typeof name === 'string') {
      meta.name = name.trim();
    }

    // MAJ logo si fourni
    let savedFile = null;
    let mtime = null;
    const out = tenantLogoPath(tenantId);

    if (logoDataUrl != null) {
      // dataURL fourni : écrire (si chaîne vide => suppression)
      if (logoDataUrl && /^data:/i.test(logoDataUrl)) {
        saveDataUrlToPng(logoDataUrl, out);
        savedFile = out;
      } else {
        // "suppression" du logo
        if (fs.existsSync(out)) {
          try { fs.unlinkSync(out); } catch {}
        }
        savedFile = null;
      }
    } else if (srcLogoPath && fs.existsSync(srcLogoPath)) {
      // Copie depuis un chemin local (optionnel)
      ensureDir(path.dirname(out));
      fs.copyFileSync(srcLogoPath, out);
      savedFile = out;
    }

    writeTenantBrand(tenantId, meta);

    if (savedFile && fs.existsSync(savedFile)) {
      try { mtime = fs.statSync(savedFile).mtimeMs; } catch {}
    }

    return {
      ok: true,
      tenantId,
      name: meta.name || null,
      file: savedFile || (fs.existsSync(out) ? out : null),
      mtime
    };
  });
}

module.exports = { registerBrandingIpc };
