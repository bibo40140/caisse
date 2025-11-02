// caisse-api/routes/tenants.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired, superAdminOnly } from '../middleware/auth.js';

const router = express.Router();

let HAS_DELETED_AT = null;
async function ensureDeletedAtFlag() {
  if (HAS_DELETED_AT !== null) return HAS_DELETED_AT;
  const r = await pool.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='tenants' AND column_name='deleted_at'
    LIMIT 1
  `);
  HAS_DELETED_AT = r.rowCount > 0;
  return HAS_DELETED_AT;
}

router.get('/', authRequired, superAdminOnly, async (_req, res) => {
  try {
    const hasDeleted = await ensureDeletedAtFlag();

    const sql = `
      SELECT
        t.id,
        t.name,
        ts.company_name,
        u.admin_email
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT email AS admin_email
        FROM users
        WHERE tenant_id = t.id AND role = 'admin'
        ORDER BY id ASC
        LIMIT 1
      ) u ON TRUE
      ${hasDeleted ? 'WHERE t.deleted_at IS NULL' : ''}
      ORDER BY t.name COLLATE "C";
    `;

    const q = await pool.query(sql);
    return res.json({ tenants: q.rows || [] });
  } catch (e) {
    console.error('[GET /tenants] error:', e);
    return res.status(500).json({ error: 'tenants list failed' });
  }
});

router.delete('/:id', authRequired, superAdminOnly, async (req, res) => {
  const id = req.params.id;
  const hard = String(req.query.hard || '0') === '1';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hasDeleted = await ensureDeletedAtFlag();

    if (hard || !hasDeleted) {
      await client.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    } else {
      await client.query(`UPDATE tenants SET deleted_at = NOW() WHERE id = $1`, [id]);
    }

    await client.query('COMMIT');
    return res.json({ ok: true, hard: hard || !hasDeleted });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[DELETE /tenants/:id] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

export default router;
