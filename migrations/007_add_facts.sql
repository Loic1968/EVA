-- EVA: Structured facts for persistent memory (facts + corrections override)
-- Run: psql "$DATABASE_URL" -f eva/migrations/007_add_facts.sql
-- Gated by EVA_STRUCTURED_MEMORY=true

BEGIN;

CREATE TABLE IF NOT EXISTS eva.facts (
  id          SERIAL PRIMARY KEY,
  owner_id    INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  source_type  TEXT,                    -- document | conversation | correction | system
  source_id    INT,                     -- document_id or message_id when applicable
  confidence   FLOAT DEFAULT 0.8,
  priority     INT DEFAULT 0,           -- corrections=100, remember=50, document=10
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_owner_key ON eva.facts(owner_id, key);
CREATE INDEX IF NOT EXISTS idx_facts_owner_priority ON eva.facts(owner_id, priority DESC, updated_at DESC);

COMMENT ON TABLE eva.facts IS 'Structured memory: key-value facts from documents/conversations; corrections override document extraction';

COMMIT;
