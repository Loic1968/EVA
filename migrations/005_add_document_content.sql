-- Add extracted text column for document search (vol, billet, Shanghai, etc.)
BEGIN;

ALTER TABLE eva.documents
  ADD COLUMN IF NOT EXISTS content_text TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_content_fts
  ON eva.documents
  USING gin(to_tsvector('french', coalesce(content_text, '')));

COMMIT;
