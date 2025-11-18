// src/main/db/adherents.js
const db = require('./db');
const { enqueueOp } = require('./ops');
const { getDeviceId } = require('../device');

const DEVICE_ID = process.env.DEVICE_ID || getDeviceId();

/**
 * Petite aide : déclenche une sync en arrière-plan sans casser l'UI.
 */
function bgSyncSafe() {
  try {
    const { triggerBackgroundSync } = require('../sync');
    if (typeof triggerBackgroundSync === 'function') {
      triggerBackgroundSync(DEVICE_ID);
    }
  } catch (_) {
    // on ignore en silence si sync n'est pas dispo (évite les cycles)
  }
}

function getAdherents(archive = 0) {
  return db
    .prepare(
      'SELECT * FROM adherents WHERE archive = ? ORDER BY nom, prenom'
    )
    .all(archive);
}

function ajouterAdherent(data) {
  const stmt = db.prepare(`
    INSERT INTO adherents 
      (nom, prenom, email1, email2, telephone1, telephone2, adresse, code_postal, ville,
       nb_personnes_foyer, tranche_age, statut, archive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'actif'), 0)
  `);

  const info = stmt.run(
    data.nom,
    data.prenom,
    data.email1,
    data.email2,
    data.telephone1,
    data.telephone2,
    data.adresse,
    data.code_postal,
    data.ville,
    data.nb_personnes_foyer,
    data.tranche_age,
    data.statut || 'actif'
  );

  const localId = info.lastInsertRowid;

  // Enfile l'opération "adherent.created"
  enqueueOp({
    deviceId: DEVICE_ID,
    opType: 'adherent.created',
    entityType: 'adherent',
    // ⚠️ on laisse entityId avec l'id local, mais il sera ignoré côté push s'il n'est pas UUID
    entityId: String(localId),
    payload: {
      local_id: localId,
      nom: data.nom || '',
      prenom: data.prenom || '',
      email1: data.email1 || null,
      email2: data.email2 || null,
      telephone1: data.telephone1 || null,
      telephone2: data.telephone2 || null,
      adresse: data.adresse || null,
      code_postal: data.code_postal || null,
      ville: data.ville || null,
      nb_personnes_foyer: data.nb_personnes_foyer ?? null,
      tranche_age: data.tranche_age || null,
      statut: data.statut || 'actif',
      archive: 0,
    },
  });

  bgSyncSafe();

  return localId;
}

function modifierAdherent(data) {
  const stmt = db.prepare(`
    UPDATE adherents SET 
      nom = ?, prenom = ?, email1 = ?, email2 = ?, telephone1 = ?, telephone2 = ?,
      adresse = ?, code_postal = ?, ville = ?, nb_personnes_foyer = ?, tranche_age = ?,
      statut = COALESCE(?, 'actif')
    WHERE id = ?
  `);
  stmt.run(
    data.nom,
    data.prenom,
    data.email1,
    data.email2,
    data.telephone1,
    data.telephone2,
    data.adresse,
    data.code_postal,
    data.ville,
    data.nb_personnes_foyer,
    data.tranche_age,
    data.statut || 'actif',
    data.id
  );

  enqueueOp({
    deviceId: DEVICE_ID,
    opType: 'adherent.updated',
    entityType: 'adherent',
    entityId: String(data.id),
    payload: {
      id: data.id,
      nom: data.nom || '',
      prenom: data.prenom || '',
      email1: data.email1 || null,
      email2: data.email2 || null,
      telephone1: data.telephone1 || null,
      telephone2: data.telephone2 || null,
      adresse: data.adresse || null,
      code_postal: data.code_postal || null,
      ville: data.ville || null,
      nb_personnes_foyer: data.nb_personnes_foyer ?? null,
      tranche_age: data.tranche_age || null,
      statut: data.statut || 'actif',
    },
  });

  bgSyncSafe();

  return { ok: true };
}

function archiverAdherent(id) {
  db.prepare(
    `UPDATE adherents SET archive = 1, date_archivage = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);

  enqueueOp({
    deviceId: DEVICE_ID,
    opType: 'adherent.archived',
    entityType: 'adherent',
    entityId: String(id),
    payload: { id, archive: 1 },
  });

  bgSyncSafe();

  return { ok: true };
}

function reactiverAdherent(id) {
  db.prepare(
    `UPDATE adherents SET archive = 0, date_reactivation = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);

  enqueueOp({
    deviceId: DEVICE_ID,
    opType: 'adherent.reactivated',
    entityType: 'adherent',
    entityId: String(id),
    payload: { id, archive: 0 },
  });

  bgSyncSafe();

  return { ok: true };
}

module.exports = {
  getAdherents,
  ajouterAdherent,
  modifierAdherent,
  archiverAdherent,
  reactiverAdherent,
};
