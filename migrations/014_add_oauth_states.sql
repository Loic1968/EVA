-- EVA: OAuth state nonce store (Gmail hijack fix)
-- The Gmail OAuth flow used state = ownerId (a guessable integer) with a public
-- callback that trusted it, allowing an attacker to link a Gmail account to an
-- arbitrary owner (account-linking CSRF / mailbox hijack). This table holds a
-- random, single-use, short-lived nonce bound server-side to the initiating owner.
-- Idempotent: the runner re-applies every migration on each startup.

BEGIN;

CREATE TABLE IF NOT EXISTS eva.oauth_states (
  state       TEXT PRIMARY KEY,                 -- unguessable random nonce (hex)
  owner_id    INT  NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL DEFAULT 'gmail',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON eva.oauth_states(expires_at);

COMMIT;
