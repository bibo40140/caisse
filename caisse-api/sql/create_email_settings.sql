-- Migration: créer la table email_settings pour la configuration SMTP par tenant
-- Cette table stocke les paramètres SMTP chiffrés pour l'envoi d'emails de factures

CREATE TABLE IF NOT EXISTS email_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  from_name TEXT,
  from_email TEXT,
  host TEXT,
  port INTEGER,
  secure BOOLEAN DEFAULT false,
  auth_user TEXT,
  auth_pass_enc TEXT, -- Mot de passe chiffré avec AES-256-GCM
  reply_to TEXT,
  bcc TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_email_settings_tenant ON email_settings(tenant_id);

-- Commentaires
COMMENT ON TABLE email_settings IS 'Configuration SMTP par tenant pour l''envoi d''emails de factures';
COMMENT ON COLUMN email_settings.auth_pass_enc IS 'Mot de passe SMTP chiffré avec AES-256-GCM (nécessite EMAIL_SECRET_KEY)';
COMMENT ON COLUMN email_settings.enabled IS 'Indique si l''envoi d''email est activé pour ce tenant';
