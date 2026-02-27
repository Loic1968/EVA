-- EVA: Matter tracking (insurance, travel, visa, etc.)
-- Run: node eva/scripts/run-migrations.js
-- Gated by EVA_ASSISTANT_MODE / EVA_SMART_CONTEXT

BEGIN;

CREATE TABLE IF NOT EXISTS eva.objects (
  id          SERIAL PRIMARY KEY,
  owner_id    INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,   -- insurance | travel | visa | investment | health | finance
  name        TEXT,
  status      TEXT,           -- active | awaiting_reply | completed | etc.
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_objects_owner_type ON eva.objects(owner_id, object_type);
CREATE INDEX IF NOT EXISTS idx_objects_owner_updated ON eva.objects(owner_id, updated_at DESC);

COMMENT ON TABLE eva.objects IS 'Active matters: insurance, travel, visa, investments — emails/documents attach to these';

COMMIT;
