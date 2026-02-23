-- EVA Schema Alignment: ensure PROD and LOCAL have identical columns.
-- Run on both databases. Uses IF NOT EXISTS for idempotency.
--
-- Usage: node scripts/run-migration.js eva/migrations/003_align_prod_local_schema.sql
-- Or: DATABASE_URL_PROD="..." node ../../scripts/run-migration.js eva/migrations/003_align_prod_local_schema.sql

BEGIN;

-- PROD is missing these (LOCAL has them from Halisoft migration):
-- Add owners.external_user_id, owners.updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='owners' AND column_name='external_user_id') THEN
    ALTER TABLE eva.owners ADD COLUMN external_user_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='owners' AND column_name='updated_at') THEN
    ALTER TABLE eva.owners ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Add settings.created_at (LOCAL has it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='settings' AND column_name='created_at') THEN
    ALTER TABLE eva.settings ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Add data_sources.updated_at (REQUIRED by gmailSync + OAuth callback)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='data_sources' AND column_name='updated_at') THEN
    ALTER TABLE eva.data_sources ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- LOCAL is missing these (PROD has them from eva/001):
-- Add data_sources.status, data_sources.record_count
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='data_sources' AND column_name='status') THEN
    ALTER TABLE eva.data_sources ADD COLUMN status TEXT DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='eva' AND table_name='data_sources' AND column_name='record_count') THEN
    ALTER TABLE eva.data_sources ADD COLUMN record_count INT DEFAULT 0;
  END IF;
END $$;

COMMIT;
