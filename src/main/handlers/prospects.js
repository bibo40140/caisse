// src/main/handlers/prospects.js
const { readConfig } = require('../db/config');
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
const { getMailTransport } = require('../db/email');

module.exports = function registerProspectsHandlers(ipcMain) {
  ipcMain.handle('prospects:list', (_e, filters = {}) => listProspects(filters));
  ipcMain.handle('prospects:create', (_e, payload = {}) => createProspect(payload));
  ipcMain.handle('prospects:update', (_e, payload = {}) => updateProspect(payload));
  ipcMain.handle('prospects:delete', (_e, id) => deleteProspect(Number(id)));
  ipcMain.handle('prospects:status', (_e, { id, status }) => markProspectStatus(Number(id), String(status)));
ipcMain.handle('prospects:convert', (_e, { id, adherentId = null }) => {
  return convertProspectToAdherent(Number(id), adherentId ? Number(adherentId) : null);
});


  ipcMain.handle('prospects:list-email-targets', (_e, { statuses } = {}) =>
    listEmailTargets({
      statuses: Array.isArray(statuses) && statuses.length ? statuses : ['actif', 'invite'],
    })
  );
  ipcMain.handle('prospects:invitations', (_e, { prospect_id = null, limit = 200 } = {}) =>
    listProspectInvitations({ prospect_id, limit })
  );

  // envoi groupé (personnalisé OU BCC)
  ipcMain.handle('prospects:email-bulk', async (_e, payload = {}) => {
    const {
      subject,
      bodyTemplate,
      bodyHtml,
      recipients,
      date_reunion = null,
      updateStatus = true,
      sent_by = null,
    } = payload;

    if (!subject || !Array.isArray(recipients)) throw new Error('Payload invalide');

    const cfg = readConfig();
    if (!(cfg.modules?.email || cfg.modules?.emails)) {
      throw new Error("Le module E-mails n'est pas activé.");
    }

    const transporter = getMailTransport();
    const epicerie = cfg.epicerie || "Coop'az";
    const FROM_ADDR = 'epiceriecoopaz@gmail.com';

    const merge = (tpl, p) =>
      String(tpl)
        .replace(/\{\{\s*nom\s*\}\}/gi, (p.nom || '').trim())
        .replace(/\{\{\s*prenom\s*\}\}/gi, (p.prenom || '').trim())
        .replace(/\{\{\s*email\s*\}\}/gi, (p.email || '').trim())
        .replace(/\{\{\s*epicerie\s*\}\}/gi, epicerie)
        .replace(/\{\{\s*date_reunion\s*\}\}/gi, date_reunion || '');

    let sent = 0;

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
    } else if (bodyHtml && bodyHtml.trim()) {
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
    } else {
      throw new Error('Fournis bodyTemplate ou bodyHtml.');
    }

    return { status: 'ok', sent };
  });
};
