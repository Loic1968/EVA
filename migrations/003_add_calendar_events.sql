-- EVA Phase 2: Google Calendar Integration
-- Stores synced calendar events per Gmail account (same OAuth token)

BEGIN;

CREATE TABLE IF NOT EXISTS eva.calendar_events (
  id                SERIAL PRIMARY KEY,
  owner_id          INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  gmail_account_id INT NOT NULL REFERENCES eva.gmail_accounts(id) ON DELETE CASCADE,
  event_id          TEXT NOT NULL,
  title             TEXT,
  description       TEXT,
  location          TEXT,
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  html_link         TEXT,
  is_all_day        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(gmail_account_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_owner_start
  ON eva.calendar_events(owner_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_events_gmail_start
  ON eva.calendar_events(gmail_account_id, start_at DESC);

COMMENT ON TABLE eva.calendar_events IS 'Synced Google Calendar events; same OAuth as Gmail';

COMMIT;
