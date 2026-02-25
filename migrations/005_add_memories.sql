-- EVA: Persistent memories — EVA learns and remembers facts about the user
-- Run: psql "$DATABASE_URL" -f eva/migrations/005_add_memories.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eva.memories (
  id         SERIAL PRIMARY KEY,
  owner_id   INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  fact       TEXT NOT NULL,
  category   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_owner ON eva.memories(owner_id);
CREATE INDEX IF NOT EXISTS idx_memories_created ON eva.memories(owner_id, created_at DESC);

COMMENT ON TABLE eva.memories IS 'Facts EVA has learned about the user; injected into chat context';

COMMIT;
