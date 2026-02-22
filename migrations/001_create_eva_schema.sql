-- Project EVA – Database Schema
-- Run on the same PostgreSQL instance as Halisoft (trade_finance2)
-- All EVA tables live in the "eva" schema to stay isolated.
--
-- Usage: psql "$DATABASE_URL" -f migrations/001_create_eva_schema.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS eva;

-- ─── Owners (single-user for now, multi-user ready) ───
CREATE TABLE IF NOT EXISTS eva.owners (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Conversations (persist chat sessions) ───
CREATE TABLE IF NOT EXISTS eva.conversations (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES eva.owners(id),
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner ON eva.conversations(owner_id, updated_at DESC);

-- ─── Messages (individual chat messages within a conversation) ───
CREATE TABLE IF NOT EXISTS eva.messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES eva.conversations(id) ON DELETE CASCADE,
  owner_id        INT NOT NULL REFERENCES eva.owners(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  tokens_used     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON eva.messages(conversation_id, created_at);

-- ─── Drafts (Phase 2–3: approve-before-send queue) ───
CREATE TABLE IF NOT EXISTS eva.drafts (
  id                  SERIAL PRIMARY KEY,
  owner_id            INT NOT NULL REFERENCES eva.owners(id),
  channel             TEXT NOT NULL,          -- email, whatsapp, linkedin, sms
  thread_id           TEXT,                   -- external thread/conversation id
  subject_or_preview  TEXT,
  body                TEXT NOT NULL,
  confidence_score    NUMERIC(4,3),           -- 0.000–1.000
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent','edited')),
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drafts_owner_status ON eva.drafts(owner_id, status, created_at DESC);

-- ─── Audit logs (every EVA action is logged) ───
CREATE TABLE IF NOT EXISTS eva.audit_logs (
  id               SERIAL PRIMARY KEY,
  owner_id         INT NOT NULL REFERENCES eva.owners(id),
  action_type      TEXT NOT NULL,             -- query, draft_created, draft_sent, setting_changed, file_uploaded, etc.
  channel          TEXT,
  details          JSONB DEFAULT '{}',
  confidence_score NUMERIC(4,3),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_owner_time ON eva.audit_logs(owner_id, created_at DESC);

-- ─── Settings (key-value per owner: kill switch, permissions, preferences) ───
CREATE TABLE IF NOT EXISTS eva.settings (
  id          SERIAL PRIMARY KEY,
  owner_id    INT NOT NULL REFERENCES eva.owners(id),
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, key)
);

-- ─── Data sources (ingestion registrations: Gmail, WhatsApp, Drive, etc.) ───
CREATE TABLE IF NOT EXISTS eva.data_sources (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES eva.owners(id),
  source_type   TEXT NOT NULL,                -- gmail, whatsapp, linkedin, drive, documents
  external_id   TEXT,                         -- e.g. Gmail account email
  config        JSONB DEFAULT '{}',
  status        TEXT DEFAULT 'active',
  last_sync_at  TIMESTAMPTZ,
  record_count  INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sources_owner ON eva.data_sources(owner_id);

-- ─── Confidence scores (per category, tracked over time) ───
CREATE TABLE IF NOT EXISTS eva.confidence_scores (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES eva.owners(id),
  category      TEXT NOT NULL,                -- email_reply, meeting_confirm, follow_up, negotiation, etc.
  score         NUMERIC(4,3) NOT NULL,
  sample_count  INT NOT NULL DEFAULT 0,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_confidence_owner ON eva.confidence_scores(owner_id, category, recorded_at DESC);

-- ─── Documents (uploaded files for memory vault ingestion) ───
CREATE TABLE IF NOT EXISTS eva.documents (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES eva.owners(id),
  filename      TEXT NOT NULL,
  file_type     TEXT,                         -- pdf, docx, txt, csv, email_archive, etc.
  file_size     BIGINT,
  storage_path  TEXT,                         -- local path or S3 key
  status        TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','indexed','error')),
  metadata      JSONB DEFAULT '{}',
  chunk_count   INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON eva.documents(owner_id, created_at DESC);

-- ─── Behavioral feedback (corrections from the user to train EVA) ───
CREATE TABLE IF NOT EXISTS eva.feedback (
  id              SERIAL PRIMARY KEY,
  owner_id        INT NOT NULL REFERENCES eva.owners(id),
  message_id      INT REFERENCES eva.messages(id),
  draft_id        INT REFERENCES eva.drafts(id),
  feedback_type   TEXT NOT NULL CHECK (feedback_type IN ('thumbs_up','thumbs_down','correction','tone_adjust')),
  original_text   TEXT,
  corrected_text  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_owner ON eva.feedback(owner_id, created_at DESC);

COMMIT;
