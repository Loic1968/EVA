-- Notification log: track sent reminders to avoid duplicates
CREATE TABLE IF NOT EXISTS eva.notification_log (
  id                SERIAL PRIMARY KEY,
  owner_id          INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,  -- 'calendar' | 'document' | 'email'
  source_id         TEXT NOT NULL,  -- event_id, document_id, or other identifier
  lead_minutes      INT NOT NULL,   -- 15, 60, 1440 etc.
  sent_to           TEXT,          -- email or channel
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, source_type, source_id, lead_minutes)
);
CREATE INDEX IF NOT EXISTS idx_eva_notification_log_owner ON eva.notification_log(owner_id, created_at DESC);

COMMENT ON TABLE eva.notification_log IS 'Tracks EVA notifications sent (calendar reminders, etc.) to avoid duplicates';
