-- Create tenant_branding table to store logo as binary
CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name       text,
  logo_mime  text,
  logo_data  bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Touch trigger timestamp on update
CREATE OR REPLACE FUNCTION set_updated_at_branding()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tenant_branding' AND column_name='updated_at'
  ) THEN
    DROP TRIGGER IF EXISTS trg_tenant_branding_updated ON tenant_branding;
    CREATE TRIGGER trg_tenant_branding_updated
    BEFORE UPDATE ON tenant_branding
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at_branding();
  END IF;
END$$;
