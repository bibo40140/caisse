// src/main/emailReports.js
const nodemailer = require('nodemailer');
const db = require('./db/db');

// Référence vers les fonctions API (sera initialisé par main.js)
let apiGetEmailSettings = null;

function setApiGetEmailSettings(fn) {
  apiGetEmailSettings = fn;
}

/**
 * Génère le HTML pour un rapport de statistiques
 */
function generateReportHTML(stats, period, dateRange) {
  const { ventes, receptions, produits } = stats;
  
  const topProducts = (ventes.byProduct || [])
    .slice(0, 5)
    .map((p, i) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 8px;">${i + 1}</td>
        <td style="padding: 8px; font-weight: 600;">${p.nom || 'Produit inconnu'}</td>
        <td style="padding: 8px; text-align: right;">${p.quantity || 0}</td>
        <td style="padding: 8px; text-align: right; color: #10b981; font-weight: 600;">${(p.revenue || 0).toFixed(2)} €</td>
      </tr>
    `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 30px; }
        .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
        .stat-card.highlight { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; }
        .stat-label { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
        .stat-card.highlight .stat-label { color: rgba(255,255,255,0.9); }
        .stat-value { font-size: 32px; font-weight: 700; margin: 8px 0; }
        .stat-trend { font-size: 12px; color: #9ca3af; }
        .stat-card.highlight .stat-trend { color: rgba(255,255,255,0.85); }
        .section { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .section h2 { margin-top: 0; color: #1f2937; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 10px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 13px; }
        td { padding: 10px; }
        .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📊 Rapport ${period}</h1>
        <p>${dateRange}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card highlight">
          <div class="stat-label">Chiffre d'affaires</div>
          <div class="stat-value">${(ventes.total || 0).toFixed(2)} €</div>
          <div class="stat-trend">${ventes.count || 0} ventes</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Panier moyen</div>
          <div class="stat-value">${ventes.count > 0 ? (ventes.total / ventes.count).toFixed(2) : '0.00'} €</div>
          <div class="stat-trend">Par vente</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Réceptions</div>
          <div class="stat-value">${(receptions.total || 0).toFixed(2)} €</div>
          <div class="stat-trend">${receptions.count || 0} réceptions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Produits référencés</div>
          <div class="stat-value">${produits || 0}</div>
          <div class="stat-trend">Total catalogue</div>
        </div>
      </div>

      <div class="section">
        <h2>🏆 Top 5 produits vendus</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Produit</th>
              <th style="text-align: right;">Quantité</th>
              <th style="text-align: right;">CA</th>
            </tr>
          </thead>
          <tbody>
            ${topProducts || '<tr><td colspan="4" style="text-align:center;color:#9ca3af;">Aucune donnée</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="footer">
        <p>Ce rapport a été généré automatiquement par votre système de caisse.</p>
        <p>Pour toute question, veuillez contacter votre administrateur.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Récupère les statistiques pour une plage de dates
 */
async function getStatsForDateRange(dateFrom, dateTo) {
  const { getVentesStatsByRange, getReceptionsStatsByRange, getProduitsCount } = require('./handlers/statistiques');
  
  // Pas besoin de wrapper dans try/catch ici, les fonctions le gèrent déjà
  const ventes = getVentesStatsByRange(dateFrom, dateTo);
  const receptions = getReceptionsStatsByRange(dateFrom, dateTo);
  const produits = getProduitsCount();

  return { ventes, receptions, produits };
}

/**
 * Envoie un email avec le rapport (support pièces jointes)
 */
async function sendEmailReport(to, subject, htmlContent, smtpConfig, attachmentData) {
  console.log('[EmailReports] sendEmailReport - Début');
  console.log('[EmailReports]   Destinataire:', to);
  console.log('[EmailReports]   Sujet:', subject);
  
  if (!to || !to.trim()) {
    console.log('[EmailReports] ❌ Aucun destinataire configuré, email non envoyé');
    return false;
  }

  if (!smtpConfig || !smtpConfig.host || !smtpConfig.user) {
    console.log('[EmailReports] ❌ Configuration SMTP incomplète:');
    console.log('[EmailReports]   - smtpConfig existe:', !!smtpConfig);
    console.log('[EmailReports]   - host:', smtpConfig?.host || 'MANQUANT');
    console.log('[EmailReports]   - user:', smtpConfig?.user || 'MANQUANT');
    return false;
  }

  try {
    console.log('[EmailReports] Création du transporteur nodemailer...');
    console.log('[EmailReports]   Host:', smtpConfig.host);
    console.log('[EmailReports]   Port:', smtpConfig.port || 587);
    console.log('[EmailReports]   Secure:', smtpConfig.secure || false);
    console.log('[EmailReports]   User:', smtpConfig.user);
    
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.secure || false,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    const mailOptions = {
      from: smtpConfig.from || smtpConfig.user,
      to: to,
      subject: subject,
      html: htmlContent
    };

    // Ajouter les pièces jointes si fournies
    if (attachmentData && attachmentData.csv) {
      mailOptions.attachments = [
        {
          filename: attachmentData.filename || 'export.csv',
          content: attachmentData.csv,
          contentType: 'text/csv;charset=utf-8'
        }
      ];
      console.log('[EmailReports] PJ ajoutée:', attachmentData.filename);
    }

    console.log('[EmailReports] Envoi de l\'email...');
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailReports] ✅ Email envoyé avec succès à ${to}`);
    console.log('[EmailReports] Info:', info.messageId);
    return true;
  } catch (error) {
    console.error('[EmailReports] ❌ Erreur envoi email:', error.message);
    console.error('[EmailReports] Code:', error.code);
    console.error('[EmailReports] Stack:', error.stack);
    return false;
  }
}

/**
 * Récupère l'email compta et la config SMTP depuis les settings
 * Les paramètres email sont stockés côté API
 */
async function getEmailConfig() {
  try {
    console.log('[EmailReports] getEmailConfig - Début');
    
    if (!apiGetEmailSettings) {
      console.error('[EmailReports] ❌ apiGetEmailSettings non initialisé');
      return { emailCompta: null, smtpConfig: null };
    }

    console.log('[EmailReports] Appel apiGetEmailSettings...');
    const result = await apiGetEmailSettings();
    console.log('[EmailReports] Résultat API:', JSON.stringify(result, null, 2));
    
    if (!result.ok) {
      console.log('[EmailReports] ❌ API retourne ok=false, erreur:', result.error);
      return { emailCompta: null, smtpConfig: null };
    }
    
    if (!result.settings) {
      console.log('[EmailReports] ❌ Aucune configuration email trouvée (settings vide)');
      return { emailCompta: null, smtpConfig: null };
    }
    
    const settings = result.settings;
    console.log('[EmailReports] Settings bruts:', JSON.stringify(settings, (k, v) => k === 'pass' ? '***' : v, 2));
    
    // Déduire le host depuis le provider si absent
    let host = settings.host;
    if (!host && settings.provider) {
      const providerHosts = {
        'gmail': 'smtp.gmail.com',
        'outlook': 'smtp-mail.outlook.com',
        'office365': 'smtp.office365.com',
        'yahoo': 'smtp.mail.yahoo.com',
        'custom': settings.host
      };
      host = providerHosts[settings.provider.toLowerCase()] || settings.host;
      console.log('[EmailReports] Host déduit depuis provider:', settings.provider, '→', host);
    }
    
    // Construire la config SMTP
    const smtpConfig = {
      host: host,
      port: settings.port || 587,
      secure: settings.secure || false,
      user: settings.user,
      pass: settings.pass,
      from: settings.from || settings.user
    };
    
    // L'email comptable est dans le champ "comptable"
    const emailCompta = settings.comptable;
    
    console.log('[EmailReports] ✅ Config récupérée:');
    console.log('[EmailReports]   - Email compta:', emailCompta || 'NON CONFIGURÉ');
    console.log('[EmailReports]   - SMTP Host:', smtpConfig.host || 'NON CONFIGURÉ');
    console.log('[EmailReports]   - SMTP User:', smtpConfig.user || 'NON CONFIGURÉ');
    console.log('[EmailReports]   - SMTP Pass:', smtpConfig.pass ? '***CONFIGURÉ***' : 'NON CONFIGURÉ');
    console.log('[EmailReports]   - SMTP valide:', (smtpConfig.host && smtpConfig.user && smtpConfig.pass) ? 'OUI' : 'NON');
    
    return {
      emailCompta: emailCompta || null,
      smtpConfig: (smtpConfig.host && smtpConfig.user && smtpConfig.pass) ? smtpConfig : null
    };
  } catch (error) {
    console.error('[EmailReports] ❌ Exception dans getEmailConfig:', error);
    console.error('[EmailReports] Stack:', error.stack);
    return { emailCompta: null, smtpConfig: null };
  }
}

/**
 * Génère et envoie le rapport hebdomadaire
 */
async function sendWeeklyReport() {
  try {
    console.log('[EmailReports] ========== DÉBUT ENVOI RAPPORT HEBDOMADAIRE ==========');
    
    console.log('[EmailReports] Étape 1/5: Récupération config email...');
    const { emailCompta, smtpConfig } = await getEmailConfig();
    
    console.log('[EmailReports] Étape 2/5: Vérification email compta...');
    if (!emailCompta) {
      console.log('[EmailReports] ❌ ÉCHEC: Email compta non configuré');
      return false;
    }
    console.log('[EmailReports] ✅ Email compta OK:', emailCompta);

    console.log('[EmailReports] Étape 3/5: Vérification SMTP...');
    if (!smtpConfig) {
      console.log('[EmailReports] ❌ ÉCHEC: Config SMTP non valide');
      return false;
    }
    console.log('[EmailReports] ✅ Config SMTP OK');

    console.log('[EmailReports] Étape 4/5: Récupération des statistiques...');
    // Calculer la période (7 derniers jours)
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateTo.getDate() - 7);

    const stats = await getStatsForDateRange(
      dateFrom.toISOString().split('T')[0],
      dateTo.toISOString().split('T')[0]
    );
    console.log('[EmailReports] ✅ Stats récupérées:', {
      ventes: stats.ventes.total,
      receptions: stats.receptions.total,
      produits: stats.produits
    });

    console.log('[EmailReports] Étape 5/5: Génération et envoi email...');
    const dateRange = `Du ${dateFrom.toLocaleDateString('fr-FR')} au ${dateTo.toLocaleDateString('fr-FR')}`;
    const html = generateReportHTML(stats, 'Hebdomadaire', dateRange);

    const result = await sendEmailReport(
      emailCompta,
      `📊 Rapport Hebdomadaire - ${dateTo.toLocaleDateString('fr-FR')}`,
      html,
      smtpConfig
    );
    
    console.log('[EmailReports] ========== RÉSULTAT:', result ? '✅ SUCCÈS' : '❌ ÉCHEC', '==========');
    return result;
  } catch (error) {
    console.error('[EmailReports] ❌ EXCEPTION dans sendWeeklyReport:', error.message);
    console.error('[EmailReports] Stack:', error.stack);
    return false;
  }
}

/**
 * Génère et envoie le rapport mensuel
 */
async function sendMonthlyReport() {
  try {
    console.log('[EmailReports] Génération du rapport mensuel...');
    
    const { emailCompta, smtpConfig } = await getEmailConfig();
    if (!emailCompta) {
      console.log('[EmailReports] Email compta non configuré');
      return false;
    }

    // Calculer le mois précédent complet
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const dateFrom = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
    const dateTo = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);

    const stats = await getStatsForDateRange(
      dateFrom.toISOString().split('T')[0],
      dateTo.toISOString().split('T')[0]
    );

    const monthName = dateFrom.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const dateRange = `Mois de ${monthName}`;
    const html = generateReportHTML(stats, 'Mensuel', dateRange);

    return await sendEmailReport(
      emailCompta,
      `📊 Rapport Mensuel - ${monthName}`,
      html,
      smtpConfig
    );
  } catch (error) {
    console.error('[EmailReports] Erreur sendMonthlyReport:', error.message);
    return false;
  }
}

/**
 * Vérifie si aujourd'hui est un dimanche
 */
function isSunday() {
  return new Date().getDay() === 0;
}

/**
 * Vérifie si aujourd'hui est le premier dimanche du mois
 */
function isFirstSundayOfMonth() {
  const today = new Date();
  if (today.getDay() !== 0) return false; // Pas un dimanche
  
  const dayOfMonth = today.getDate();
  return dayOfMonth <= 7; // Premier dimanche = entre le 1 et le 7
}

/**
 * Démarre la planification des rapports
 */
function startEmailReportsScheduler() {
  console.log('[EmailReports] Démarrage du planificateur de rapports');
  
  // Vérifier toutes les heures si on est dimanche à midi
  const checkInterval = 60 * 60 * 1000; // 1 heure
  
  let lastWeeklyCheck = null;
  let lastMonthlyCheck = null;
  
  setInterval(async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDate = now.toISOString().split('T')[0];
    
    // Dimanche à 12h (entre 12h et 13h pour être sûr de pas rater)
    if (isSunday() && currentHour === 12) {
      
      // Rapport hebdomadaire (tous les dimanches)
      if (lastWeeklyCheck !== currentDate) {
        console.log('[EmailReports] Dimanche 12h - Envoi rapport hebdomadaire');
        await sendWeeklyReport();
        lastWeeklyCheck = currentDate;
      }
      
      // Rapport mensuel (premier dimanche du mois uniquement)
      if (isFirstSundayOfMonth() && lastMonthlyCheck !== currentDate) {
        console.log('[EmailReports] Premier dimanche du mois - Envoi rapport mensuel');
        await sendMonthlyReport();
        lastMonthlyCheck = currentDate;
      }
    }
  }, checkInterval);
  
  console.log('[EmailReports] Planificateur actif - Rapports envoyés chaque dimanche à 12h');
}

module.exports = {
  startEmailReportsScheduler,
  sendWeeklyReport,
  sendMonthlyReport,
  generateReportHTML,
  getStatsForDateRange,
  setApiGetEmailSettings,
  sendEmailReport,
  getEmailConfig
};
