-- Align LOCAL to PROD: drop NOT NULL on audit_logs.details and data_sources.config
-- (PROD has nullable; LOCAL had NOT NULL from Halisoft migration)

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='audit_logs' AND column_name='details' AND is_nullable='NO') THEN
    ALTER TABLE eva.audit_logs ALTER COLUMN details DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='data_sources' AND column_name='config' AND is_nullable='NO') THEN
    ALTER TABLE eva.data_sources ALTER COLUMN config DROP NOT NULL;
  END IF;
END $$;

COMMIT;
