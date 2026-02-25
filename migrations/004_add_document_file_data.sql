-- EVA: Add file_data and content_text to eva.documents
-- Required for upload (persist in DB) and search/indexing
-- Run: psql "$DATABASE_URL" -f eva/migrations/004_add_document_file_data.sql

BEGIN;

-- file_data: store file bytes in DB (survives ephemeral disk on Render)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'eva' AND table_name = 'documents' AND column_name = 'file_data'
  ) THEN
    ALTER TABLE eva.documents ADD COLUMN file_data BYTEA;
  END IF;
END $$;

-- content_text: extracted text for search (populated by documentProcessor)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'eva' AND table_name = 'documents' AND column_name = 'content_text'
  ) THEN
    ALTER TABLE eva.documents ADD COLUMN content_text TEXT;
  END IF;
END $$;

COMMIT;
