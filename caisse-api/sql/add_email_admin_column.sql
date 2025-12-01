-- Migration : ajouter la colonne email_admin_json pour stocker les adresses des destinataires admin
-- (comptable, équipe technique, autres) par tenant

ALTER TABLE tenant_settings
ADD COLUMN IF NOT EXISTS email_admin_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Les champs seront par exemple :
-- {
--   "sender_email": "admin@coopaz.fr",
--   "sender_name": "Coop'az Admin",
--   "comptable": "compta@example.com",
--   "equipe_technique": "support@example.com",
--   "autres": "autre1@example.com,autre2@example.com"
-- }

COMMENT ON COLUMN tenant_settings.email_admin_json IS 'Configuration des adresses email admin pour rapports (comptable, équipe technique, autres)';
