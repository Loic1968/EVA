-- EVA: Structured memory for learning (corrections > preferences > facts)
-- Run: psql "$DATABASE_URL" -f eva/migrations/006_add_memory_items.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eva.memory_items (
  id         SERIAL PRIMARY KEY,
  owner_id   INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('correction', 'preference', 'fact')),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  priority   INT NOT NULL DEFAULT 3,  -- 1=correction, 2=preference, 3=fact
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_owner_key ON eva.memory_items(owner_id, key);
CREATE INDEX IF NOT EXISTS idx_memory_items_owner_priority ON eva.memory_items(owner_id, priority ASC, updated_at DESC);

COMMENT ON TABLE eva.memory_items IS 'Structured memory: corrections override preferences override facts';

COMMIT;
