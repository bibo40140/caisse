// routes/emailSettings.js
import { Router } from 'express';
import nodemailer from 'nodemailer';
import { getEmailSettings, upsertEmailSettings } from '../models/emailSettingsRepo.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

const router = Router();

/**
 * GET /tenants/:tenantId/email-settings
 * -> ne JAMAIS renvoyer le mot de passe en clair
 * -> expose hasPassword:true/false pour l’UI
 */
router.get('/tenants/:tenantId/email-settings', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const s = await getEmailSettings(tenantId);
    if (!s) return res.json({ exists: false });

    const out = {
      exists: true,
      tenant_id: s.tenant_id,
      enabled: !!s.enabled,
      from_name: s.from_name,
      from_email: s.from_email,
      host: s.host,
      port: s.port,
      secure: !!s.secure,
      auth_user: s.auth_user,
      hasPassword: !!s.auth_pass_enc,
      reply_to: s.reply_to || '',
      bcc: s.bcc || '',
      updated_at: s.updated_at
    };
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_get_email_settings' });
  }
});

/**
 * PUT /tenants/:tenantId/email-settings
 * body: { enabled, from_name, from_email, host, port, secure, auth_user, auth_pass?, reply_to?, bcc? }
 * -> si auth_pass est vide, conserver l’existant
 */
router.put('/tenants/:tenantId/email-settings', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const body = req.body || {};
    const current = await getEmailSettings(tenantId);

    let authPassEnc = current?.auth_pass_enc || null;
    if (body.auth_pass && String(body.auth_pass).trim() !== '') {
      authPassEnc = encryptSecret(String(body.auth_pass));
    }
    if (!authPassEnc) {
      // si on veut activer mais pas de mot de passe connu -> 400
      if (body.enabled) {
        return res.status(400).json({ error: 'password_required_to_enable' });
      }
    }

    await upsertEmailSettings({
      tenant_id: tenantId,
      enabled: !!body.enabled,
      from_name: body.from_name,
      from_email: body.from_email,
      host: body.host,
      port: Number(body.port),
      secure: !!body.secure,
      auth_user: body.auth_user,
      auth_pass_enc: authPassEnc,
      reply_to: body.reply_to || null,
      bcc: body.bcc || null
    });

    res.sendStatus(204);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_update_email_settings' });
  }
});

/**
 * POST /tenants/:tenantId/email-settings/test
 * body: { to? } -> envoie un mail de test
 */
router.post('/tenants/:tenantId/email-settings/test', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { to } = req.body || {};
    const s = await getEmailSettings(tenantId);
    if (!s) return res.status(404).json({ error: 'settings_not_found' });
    if (!s.auth_pass_enc) return res.status(400).json({ error: 'password_missing' });

    const transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: !!s.secure,
      auth: {
        user: s.auth_user,
        pass: decryptSecret(s.auth_pass_enc)
      }
    });

    const toAddr = to || s.from_email;
    await transporter.sendMail({
      from: `"${s.from_name}" <${s.from_email}>`,
      to: toAddr,
      subject: 'Test e-mail — Coopaz',
      text: 'Test OK — paramètres SMTP valides.',
    });

    res.json({ ok: true, to: toAddr });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_send_test_email', detail: String(e && e.message || e) });
  }
});

export default router;
