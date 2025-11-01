// src/main/handlers/prospects.js
const {
  listProspects,
  createProspect,
  updateProspect,
  deleteProspect,
  markProspectStatus,
  convertProspectToAdherent,
  listEmailTargets,
  addProspectInvitation,
  listProspectInvitations,
} = require('../db/prospects');

const db = require('../db/db'); // ← SQLite tenant-aware
const { getMailTransport, getDefaultFrom } = require('../db/email');

/**
 * Lit les modules actifs depuis tenant_settings (key='modules').
 * Retourne toujours un objet (éventuellement {}).
 */
function getTenantModules() {
  try {
    const row = db.prepare(
      `SELECT value_json FROM tenant_settings WHERE key = 'modules'`
    ).get();
    if (!row || !row.value_json) return {};
    const mods = JSON.parse(row.value_json);
    return (mods && typeof mods === 'object') ? mods : {};
  } catch {
    return {};
  }
}

module.exports = function registerProspectsHandlers(ipcMain) {
  ipcMain.handle('prospects:list', (_e, filters = {}) => listProspects(filters));
  ipcMain.handle('prospects:create', (_e, payload = {}) => createProspect(payload));
  ipcMain.handle('prospects:update', (_e, payload = {}) => updateProspect(payload));
  ipcMain.handle('prospects:delete', (_e, id) => deleteProspect(Number(id)));
  ipcMain.handle('prospects:status', (_e, { id, status }) =>
    markProspectStatus(Number(id), String(status))
  );
  ipcMain.handle('prospects:convert', (_e, { id, adherentId = null }) =>
    convertProspectToAdherent(Number(id), adherentId ? Number(adherentId) : null)
  );

  ipcMain.handle('prospects:list-email-targets', (_e, { statuses } = {}) =>
    listEmailTargets({
      statuses: Array.isArray(statuses) && statuses.length ? statuses : ['actif', 'invite'],
    })
  );

  ipcMain.handle('prospects:invitations', (_e, { prospect_id = null, limit = 200 } = {}) =>
    listProspectInvitations({ prospect_id, limit })
  );

  // ————————————————————————————————————————————————————————
  // ✉️ Envoi groupé (personnalisé ou BCC) — tenant-aware
  // ————————————————————————————————————————————————————————
  ipcMain.handle('prospects:email-bulk', async (_e, payload = {}) => {
    const {
      subject,
      bodyTemplate,   // HTML avec placeholders {{nom}}, {{prenom}}, {{email}}, {{epicerie}}, {{date_reunion}}
      bodyHtml,       // HTML brut (pour envoi BCC massif)
      recipients,     // [{ id, email, nom, prenom, status }, ...]
      date_reunion = null,
      updateStatus = true,
      sent_by = null,
    } = payload || {};

    if (!subject || !Array.isArray(recipients)) {
      throw new Error('Payload invalide (subject ou recipients manquants).');
    }

    // 1) Vérifier que le module e-mails est actif pour ce tenant
    const mods = getTenantModules();
    const emailsOn = !!(mods.email || mods.emails);
    if (!emailsOn) {
      throw new Error("Le module E-mails n'est pas activé pour ce tenant.");
    }

    // 2) Récupérer le transport et l’adresse expéditeur depuis la config e-mail du tenant
    const transporter = getMailTransport(); // lèvera si provider=disabled ou config incomplète
    const FROM_ADDR = getDefaultFrom();

    // Petit helper de templating
    const epicerie = (mods?.nom_epicerie || "Coop'az"); // si tu stockes le nom dans modules ; sinon remplace par une autre source
    const merge = (tpl, p) =>
      String(tpl)
        .replace(/\{\{\s*nom\s*\}\}/gi, (p.nom || '').trim())
        .replace(/\{\{\s*prenom\s*\}\}/gi, (p.prenom || '').trim())
        .replace(/\{\{\s*email\s*\}\}/gi, (p.email || '').trim())
        .replace(/\{\{\s*epicerie\s*\}\}/gi, epicerie)
        .replace(/\{\{\s*date_reunion\s*\}\}/gi, date_reunion || '');

    let sent = 0;

    // 3) Mode "personnalisé" (un mail par prospect avec merge)
    if (bodyTemplate && bodyTemplate.trim()) {
      for (const r of recipients) {
        const to = (r.email || '').trim();
        if (!to) continue;

        const html = merge(bodyTemplate, r);
        await transporter.sendMail({ from: FROM_ADDR, to, subject, html });

        if (updateStatus && String(r.status || '').toLowerCase() === 'actif') {
          try { await markProspectStatus(Number(r.id), 'invite'); } catch {}
        }
        try {
          addProspectInvitation({
            prospect_id: Number(r.id),
            subject,
            body_html: html,
            date_reunion,
            sent_by,
          });
        } catch {}
        sent++;
      }

      return { status: 'ok', sent };
    }

    // 4) Mode "BCC massif"
    if (bodyHtml && bodyHtml.trim()) {
      const bcc = recipients.map(r => (r.email || '').trim()).filter(Boolean);
      if (bcc.length === 0) return { status: 'empty' };

      await transporter.sendMail({ from: FROM_ADDR, bcc, subject, html: bodyHtml });

      for (const r of recipients) {
        if (updateStatus && String(r.status || '').toLowerCase() === 'actif') {
          try { await markProspectStatus(Number(r.id), 'invite'); } catch {}
        }
        try {
          addProspectInvitation({
            prospect_id: Number(r.id),
            subject,
            body_html: bodyHtml,
            date_reunion,
            sent_by,
          });
        } catch {}
      }

      sent = bcc.length;
      return { status: 'ok', sent };
    }

    // 5) Aucun corps fourni
    throw new Error('Fournis bodyTemplate (HTML avec placeholders) ou bodyHtml (HTML brut).');
  });
};
