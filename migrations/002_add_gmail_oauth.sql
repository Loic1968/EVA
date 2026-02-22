-- EVA Phase 2: Gmail OAuth2 Integration
-- Adds tables for Gmail account connections, synced emails, and attachments

BEGIN;

-- ============================================================
-- 1. Gmail Accounts — OAuth token storage (one per connection)
-- ============================================================
CREATE TABLE IF NOT EXISTS eva.gmail_accounts (
  id                        SERIAL PRIMARY KEY,
  owner_id                  INT NOT NULL REFERENCES eva.owners(id),
  gmail_address             TEXT NOT NULL,
  access_token              TEXT NOT NULL,
  refresh_token             TEXT,
  token_scope               TEXT,
  expires_at                TIMESTAMPTZ,
  sync_status               TEXT DEFAULT 'pending'
                            CHECK (sync_status IN ('pending','syncing','active','error','disabled')),
  full_sync_complete        BOOLEAN DEFAULT FALSE,
  last_sync_at              TIMESTAMPTZ,
  last_history_id           TEXT,
  error_message             TEXT,
  token_updated_at          TIMESTAMPTZ DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, gmail_address)
);

-- ============================================================
-- 2. Emails — Synced email content & metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS eva.emails (
  id                SERIAL PRIMARY KEY,
  owner_id          INT NOT NULL REFERENCES eva.owners(id),
  gmail_account_id  INT NOT NULL REFERENCES eva.gmail_accounts(id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,
  thread_id         TEXT,
  from_email        TEXT NOT NULL,
  from_name         TEXT,
  to_emails         TEXT[],
  cc_emails         TEXT[],
  subject           TEXT,
  snippet           TEXT,
  body_plain        TEXT,
  body_html         TEXT,
  labels            TEXT[],
  is_read           BOOLEAN DEFAULT FALSE,
  is_starred        BOOLEAN DEFAULT FALSE,
  has_attachments   BOOLEAN DEFAULT FALSE,
  received_at       TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gmail_account_id, message_id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_emails_owner_received
  ON eva.emails(owner_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_from
  ON eva.emails(from_email);

CREATE INDEX IF NOT EXISTS idx_emails_thread
  ON eva.emails(thread_id);

-- Full-text search index (English) on subject + body
CREATE INDEX IF NOT EXISTS idx_emails_fts
  ON eva.emails
  USING gin(to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_plain,'')));

-- ============================================================
-- 3. Email Attachments — metadata only (no binary storage yet)
-- ============================================================
CREATE TABLE IF NOT EXISTS eva.email_attachments (
  id            SERIAL PRIMARY KEY,
  email_id      INT NOT NULL REFERENCES eva.emails(id) ON DELETE CASCADE,
  attachment_id TEXT,
  filename      TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

COMMIT;
