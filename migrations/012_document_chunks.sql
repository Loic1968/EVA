-- document_chunks: chunked index for doc search with citations
-- Enables searchDocumentsByChunks + MCP docs.search
BEGIN;

CREATE TABLE IF NOT EXISTS eva.document_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id INTEGER NOT NULL REFERENCES eva.documents(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id ON eva.document_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_owner_id ON eva.document_chunks(owner_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv ON eva.document_chunks USING gin(tsv);

COMMIT;
