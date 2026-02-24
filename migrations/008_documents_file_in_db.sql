-- Store document file content in DB so uploads survive Render ephemeral disk
-- (each deploy wipes the container filesystem)
BEGIN;

ALTER TABLE eva.documents
  ADD COLUMN IF NOT EXISTS file_data BYTEA;

COMMENT ON COLUMN eva.documents.file_data IS 'File content stored in DB for persistence across deploys (Render ephemeral disk)';

COMMIT;
