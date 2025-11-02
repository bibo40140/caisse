// src/main/branding.js
'use strict';

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function dataDir() {
  const base = app.getPath('userData');
  const dir = path.join(base, 'branding');
  ensureDir(dir);
  return dir;
}

function brandJsonPath() {
  return path.join(dataDir(), 'brand.json');
}
function logoFilePath() {
  // nom stable
  return path.join(dataDir(), 'logo.png');
}

function readBrand() {
  try {
    const p = brandJsonPath();
    if (!fs.existsSync(p)) return {};
    const js = JSON.parse(fs.readFileSync(p, 'utf8'));
    return js || {};
  } catch (_) {
    return {};
  }
}

function writeBrand(js) {
  const p = brandJsonPath();
  fs.writeFileSync(p, JSON.stringify(js || {}, null, 2), 'utf8');
}

function saveDataUrlToPng(dataUrl, outPath) {
  // supporte data:image/png;base64,...
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Logo invalide (dataURL attendu)');
  const buf = Buffer.from(m[2], 'base64');
  fs.writeFileSync(outPath, buf);
  return { mime: m[1], size: buf.length };
}

function registerBrandingIpc() {
  // ✅ idempotent: on retire d’abord d’éventuels handlers existants
  try { ipcMain.removeHandler('branding:get'); } catch {}
  try { ipcMain.removeHandler('branding:set'); } catch {}

  // GET
  ipcMain.handle('branding:get', async () => {
    const meta = readBrand();
    const logoPath = logoFilePath();
    let mtime = null;
    if (fs.existsSync(logoPath)) {
      try { mtime = fs.statSync(logoPath).mtimeMs; } catch {}
    }
    return { ok: true, ...meta, logoFile: fs.existsSync(logoPath) ? logoPath : null, mtime };
  });

  // SET
  ipcMain.handle('branding:set', async (_e, payload = {}) => {
    const meta = readBrand();

    if (typeof payload.name === 'string' && payload.name.trim()) {
      meta.name = payload.name.trim();
    }

    let savedFile = null;
    let mtime = null;

    if (payload.logoDataUrl) {
      const out = logoFilePath();
      saveDataUrlToPng(payload.logoDataUrl, out);
      savedFile = out;
      try { mtime = fs.statSync(out).mtimeMs; } catch {}
    } else if (payload.logoPath && fs.existsSync(payload.logoPath)) {
      // Optionnel: copie depuis un chemin local
      const out = logoFilePath();
      fs.copyFileSync(payload.logoPath, out);
      savedFile = out;
      try { mtime = fs.statSync(out).mtimeMs; } catch {}
    }

    writeBrand(meta);

    return { ok: true, name: meta.name || null, file: savedFile || (fs.existsSync(logoFilePath()) ? logoFilePath() : null), mtime };
  });
}

module.exports = { registerBrandingIpc };
