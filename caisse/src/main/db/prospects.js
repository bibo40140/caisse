// src/main/db/prospects.js
const db = require('./db');

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

function tableExists(table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}



const VALID_STATUS = new Set(['actif', 'invite', 'venu_reunion', 'converti', 'annule']);

function _normalize(p = {}) {
  const data = { ...p };
  const keep = ['nom','prenom','email','telephone','adresse','code_postal','ville','note','status','adherent_id'];
  Object.keys(data).forEach(k => { if (!keep.includes(k)) delete data[k]; });
  if (data.status && !VALID_STATUS.has(data.status)) {
    throw new Error(`Statut prospect invalide: ${data.status}`);
  }
  return data;
}

// --- CRUD prospects (tes fonctions existantes) ---
function createProspect(p) {
  const data = _normalize(p);
  if (!(data.nom || data.prenom || data.email)) {
    throw new Error('Veuillez renseigner au moins un nom/prénom ou un email.');
  }
  const stmt = db.prepare(`
    INSERT INTO prospects (nom, prenom, email, telephone, adresse, code_postal, ville, note, status)
    VALUES (@nom, @prenom, @email, @telephone, @adresse, @code_postal, @ville, @note, COALESCE(@status,'actif'))
  `);
  const res = stmt.run(data);
  return getProspect(res.lastInsertRowid);
}
function getProspect(id) {
  return db.prepare(`SELECT * FROM prospects WHERE id = ?`).get(id);
}
function listProspects({ q = null, status = null, limit = 200 } = {}) {
  let sql = `SELECT * FROM prospects WHERE 1=1`;
  const params = [];

  if (status) {
    if (Array.isArray(status) && status.length) {
      sql += ` AND status IN (${status.map(() => '?').join(',')})`;
      params.push(...status);
    } else {
      sql += ` AND status = ?`;
      params.push(status);
    }
  }
  if (q) {
    const Q = `%${String(q).toLowerCase()}%`;
    sql += `
      AND (
        lower(nom) LIKE ? OR
        lower(prenom) LIKE ? OR
        lower(email) LIKE ? OR
        lower(telephone) LIKE ? OR
        lower(ville) LIKE ?
      )
    `;
    params.push(Q, Q, Q, Q, Q);
  }
  sql += ` ORDER BY date_creation DESC, id DESC LIMIT ?`;
  params.push(Number(limit) || 200);
  return db.prepare(sql).all(...params);
}
function updateProspect(p) {
  if (!p || !p.id) throw new Error('id requis');
  const cur = getProspect(p.id);
  if (!cur) throw new Error('Prospect introuvable');

  const data = _normalize(p);
  delete data.id;

  const keys = Object.keys(data);
  if (!keys.length) return cur;

  const set = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE prospects SET ${set} WHERE id = @id`).run({ ...data, id: p.id });
  return getProspect(p.id);
}
function deleteProspect(id) {
  return db.prepare(`DELETE FROM prospects WHERE id = ?`).run(id);
}
function markProspectStatus(id, status) {
  if (!VALID_STATUS.has(status)) throw new Error('Statut invalide');
  db.prepare(`UPDATE prospects SET status = ? WHERE id = ?`).run(status, id);
  return getProspect(id);
}

// --- Historique d’invitations ---
function addProspectInvitation({ prospect_id, subject, body_html, date_reunion = null, sent_by = null }) {
  const stmt = db.prepare(`
    INSERT INTO prospects_invitations (prospect_id, subject, body_html, date_reunion, sent_by)
    VALUES (@prospect_id, @subject, @body_html, @date_reunion, @sent_by)
  `);
  const res = stmt.run({ prospect_id, subject, body_html, date_reunion, sent_by });
  return db.prepare(`SELECT * FROM prospects_invitations WHERE id = ?`).get(res.lastInsertRowid);
}
function listProspectInvitations({ prospect_id = null, limit = 200 } = {}) {
  let sql = `SELECT * FROM prospects_invitations`;
  const params = [];
  if (prospect_id) {
    sql += ` WHERE prospect_id = ?`;
    params.push(Number(prospect_id));
  }
  sql += ` ORDER BY sent_at DESC, id DESC LIMIT ?`;
  params.push(Number(limit) || 200);
  return db.prepare(sql).all(...params);
}

// --- Conversion vers adhérent ---
function convertProspectToAdherent(prospectId, adherentId = null) {
  prospectId = Number(prospectId);
  if (!prospectId) throw new Error('prospectId requis');

  // 1) Récupérer le prospect
  const getProspect = db.prepare(`SELECT * FROM prospects WHERE id = ?`);
  const p = getProspect.get(prospectId);
  if (!p) throw new Error('Prospect introuvable');

  // 2) Si aucun adherentId fourni → créer un adhérent minimal
  let createdAdhId = null;
  if (!adherentId) {
    // Adapté au schéma que tu utilises (email1 / telephone1, etc.)
    const insertAdh = db.prepare(`
      INSERT INTO adherents
        (nom, prenom, email1, telephone1, adresse, code_postal, ville, date_inscription)
      VALUES
        (@nom, @prenom, @email1, @telephone1, @adresse, @code_postal, @ville, datetime('now'))
    `);

    const res = insertAdh.run({
      nom:         p.nom || null,
      prenom:      p.prenom || null,
      email1:      p.email || null,
      telephone1:  p.telephone || null,
      adresse:     p.adresse || null,
      code_postal: p.code_postal || null,
      ville:       p.ville || null
    });
    createdAdhId = res.lastInsertRowid;
    adherentId   = createdAdhId;
  }

  // 3) Marquer le prospect comme converti + mémoriser le lien
  const upd = db.prepare(`UPDATE prospects SET status = ?, adherent_id = ? WHERE id = ?`);
  upd.run('converti', adherentId ? Number(adherentId) : null, prospectId);

  // 4) Retourner un objet utile côté UI
  const prospectMaj = getProspect.get(prospectId);
  return {
    prospect: prospectMaj,
    adherent_id: adherentId || null,
    created: !!createdAdhId
  };
}


module.exports = {
  // prospects
  createProspect,
  getProspect,
  listProspects,
  updateProspect,
  deleteProspect,
  markProspectStatus,
  convertProspectToAdherent,

  // invitations
  addProspectInvitation,
  listProspectInvitations,
};
