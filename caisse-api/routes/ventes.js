// caisse-api/routes/ventes.js
import express from 'express';
import { pool } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { getEmailSettings } from '../models/emailSettingsRepo.js';
import { decryptSecret } from '../utils/crypto.js';
import nodemailer from 'nodemailer';

const router = express.Router();

/**
 * POST /ventes
 * body: {
 *   sale_type: 'adherent'|'exterieur'|'prospect',
 *   adherent_id?, client_email?, mode_paiement_id?, frais_paiement?, cotisation?,
 *   lignes: [{ produit_id, quantite, prix, prix_unitaire?, remise_percent? }]
 * }
 * Effets: crée vente + lignes, décrémente stock.
 */
router.post('/ventes', authRequired, async (req, res) => {
  const tenantId = req.user?.tenant_id;
  const {
    sale_type = 'adherent',
    adherent_id = null,
    client_email = null,
    mode_paiement_id = null,
    frais_paiement = 0,
    cotisation = 0,
    lignes = []
  } = req.body || {};
  if (!tenantId || !Array.isArray(lignes) || !lignes.length) {
    return res.status(400).json({ error: 'lignes requises' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO ventes (tenant_id, sale_type, adherent_id, client_email, mode_paiement_id, frais_paiement, cotisation, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0)
       RETURNING id`,
      [tenantId, sale_type, adherent_id, client_email, mode_paiement_id, Number(frais_paiement||0), Number(cotisation||0)]
    );
    const venteId = r.rows[0].id;

    let total = 0;
    for (const l of lignes) {
      const pid = Number(l.produit_id);
      const qty = Number(l.quantite || 0);
      const pu  = Number(l.prix || 0); // PU appliqué
      if (!Number.isFinite(pid) || qty <= 0 || pu < 0) continue;

      const ligneTotal = pu * qty;
      total += ligneTotal;

      await client.query(
        `INSERT INTO lignes_vente (vente_id, produit_id, quantite, prix, prix_unitaire, remise_percent, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [venteId, pid, qty, pu, Number(l.prix_unitaire||pu), Number(l.remise_percent||0), ligneTotal]
      );

      await client.query(
        `UPDATE produits SET stock = COALESCE(stock,0) - $1 WHERE tenant_id=$2 AND id=$3`,
        [qty, tenantId, pid]
      );
    }

    await client.query(`UPDATE ventes SET total = $1 WHERE id = $2`, [total, venteId]);
    await client.query('COMMIT');

    // Envoi email facture si module actif
    try {
      // Récupérer les modules du tenant
      const modulesRes = await pool.query(
        `SELECT modules_json FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      const modules = modulesRes.rows[0]?.modules_json || {};
      if (modules.email_facture) {
        // Déterminer l'email destinataire
        let emailDest = client_email;
        if (!emailDest && adherent_id) {
          // Récupérer l'email1 de l'adhérent
          const adhRes = await pool.query(
            `SELECT email1 FROM adherents WHERE tenant_id = $1 AND id = $2`,
            [tenantId, adherent_id]
          );
          emailDest = adhRes.rows[0]?.email1 || null;
        }

        if (emailDest) {
          // Récupérer la config email
          const emailSettings = await getEmailSettings(tenantId);
          if (emailSettings && emailSettings.enabled) {
            const transporter = nodemailer.createTransport({
              host: emailSettings.host,
              port: emailSettings.port,
              secure: !!emailSettings.secure,
              auth: {
                user: emailSettings.auth_user,
                pass: decryptSecret(emailSettings.auth_pass_enc)
              }
            });
            // Générer un contenu simple de facture (à améliorer)
            const factureText = `Merci pour votre achat. Montant total : ${total} €.`;
            transporter.sendMail({
              from: `${emailSettings.from_name} <${emailSettings.from_email}>`,
              to: emailDest,
              subject: 'Votre facture',
              text: factureText
            }).catch(e => {
              console.error('[VENTE] Erreur envoi email facture:', e);
            });
            console.log(`[VENTE] Email facture envoyé à ${emailDest} pour vente #${venteId}`);
          }
        }
      }
    } catch (e) {
      console.error('[VENTE] Erreur logique email facture:', e);
    }

    return res.json({ ok: true, vente_id: venteId, total });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /ventes] error:', e);
    return res.status(500).json({ error: 'create vente failed' });
  } finally {
    client.release();
  }
});

export default router;
