// routes/branding.js
import express from 'express';
import { pool } from '../db/index.js';

const router = express.Router();

/**
 * GET /branding
 * Retourne les métadonnées du branding du tenant courant.
 * Nécessite authRequired en amont pour remplir req.tenantId.
 */
router.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ ok:false, error:'unauthorized' });

  try {
    const r = await pool.query(
      `SELECT name, logo_mime, (logo_bytes IS NOT NULL) AS has_logo, updated_at
       FROM tenant_branding
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = r.rows[0] || null;
    return res.json({
      ok: true,
      name: row?.name || null,
      has_logo: !!row?.has_logo,
      logo_mime: row?.logo_mime || null,
      updated_at: row?.updated_at || null
    });
  } catch (e) {
    console.error('[branding] GET meta error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/**
 * GET /branding/logo
 * Renvoie le binaire du logo (Content-Type image/*).
 */
router.get('/logo', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ ok:false, error:'unauthorized' });

  try {
    const r = await pool.query(
      `SELECT logo_mime, logo_bytes, EXTRACT(EPOCH FROM updated_at)::bigint AS etag
       FROM tenant_branding
       WHERE tenant_id = $1`,
      [tenantId]
    );
    if (r.rowCount === 0 || !r.rows[0].logo_bytes) {
      return res.status(404).json({ ok:false, error:'no_logo' });
    }
    const { logo_mime, logo_bytes, etag } = r.rows[0];

    // Caching simple côté client
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('ETag', `"${etag}"`);
    res.setHeader('Content-Type', logo_mime || 'application/octet-stream');
    return res.end(logo_bytes);
  } catch (e) {
    console.error('[branding] GET logo error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/**
 * PUT /branding
 * body: { name?, logoDataUrl?, deleteLogo? }
 * - name : string affiché dans l’UI
 * - logoDataUrl : "data:image/png;base64,...." (ou jpeg/webp)
 * - deleteLogo : true pour effacer le logo
 */
router.put('/', async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ ok:false, error:'unauthorized' });

  const { name, logoDataUrl, deleteLogo } = req.body || {};

  // Parse éventuel dataURL
  let mime = null;
  let buf = null;

  try {
    if (deleteLogo === true) {
      mime = null; buf = null;
    } else if (logoDataUrl) {
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(logoDataUrl));
      if (!m) return res.status(400).json({ ok:false, error:'invalid_logo_data_url' });
      mime = m[1].toLowerCase();
      buf = Buffer.from(m[2], 'base64');
      // hard limit: 1 Mo
      if (buf.length > 1_000_000) {
        return res.status(413).json({ ok:false, error:'logo_too_large_max_1mb' });
      }
    }
  } catch (e) {
    return res.status(400).json({ ok:false, error:'invalid_logo_payload' });
  }

  // Build SQL dynamique
  const fields = [];
  const values = [tenantId];
  let i = 1;

  if (typeof name === 'string') { fields.push(`name = $${++i}`); values.push(name.trim()); }
  if (deleteLogo === true) {
    fields.push(`logo_mime = NULL`, `logo_bytes = NULL`);
  } else if (buf) {
    fields.push(`logo_mime = $${++i}`); values.push(mime);
    fields.push(`logo_bytes = $${++i}`); values.push(buf);
  }
  if (fields.length === 0) {
    // rien à mettre à jour → renvoyer l’état actuel
    const cur = await pool.query(
      `SELECT name, logo_mime, (logo_bytes IS NOT NULL) AS has_logo, updated_at
       FROM tenant_branding WHERE tenant_id=$1`,
      [tenantId]
    );
    const row = cur.rows[0] || null;
    return res.json({ ok:true, name: row?.name || null, has_logo: !!row?.has_logo, updated_at: row?.updated_at || null });
  }
  fields.push(`updated_at = now()`);

  const sql = `
    INSERT INTO tenant_branding(tenant_id, name, logo_mime, logo_bytes, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (tenant_id)
    DO UPDATE SET ${fields.join(', ')}
    RETURNING name, logo_mime, (logo_bytes IS NOT NULL) AS has_logo, updated_at
  `;

  // Pour l'INSERT, il faut aligner 4 valeurs ($1..$4) — on calcule à partir de values
  // Construisons les 4 colonnes avec les valeurs actuelles connues
  let insertName = null, insertMime = null, insertBytes = null;
  // On préfère l’intention courante si fournie
  if (typeof name === 'string') insertName = name.trim();
  if (deleteLogo === true) { insertMime = null; insertBytes = null; }
  else if (buf) { insertMime = mime; insertBytes = buf; }

  const insertParams = [
    tenantId,
    insertName, insertMime, insertBytes
  ];

  try {
    const r = await pool.query(sql, [...insertParams, ...values.slice(1)]);
    const row = r.rows[0];
    return res.json({ ok:true, name: row?.name || null, has_logo: !!row?.has_logo, updated_at: row?.updated_at || null });
  } catch (e) {
    console.error('[branding] PUT error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

export default router;
