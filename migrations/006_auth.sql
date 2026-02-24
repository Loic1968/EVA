-- EVA Auth: signup, login, forgot password
BEGIN;

-- Add password hash to owners (nullable for backward compat)
ALTER TABLE eva.owners ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Password reset tokens (valid 1 hour)
CREATE TABLE IF NOT EXISTS eva.password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eva_password_reset_email ON eva.password_reset_tokens(email);
CREATE INDEX IF NOT EXISTS idx_eva_password_reset_expires ON eva.password_reset_tokens(expires_at);

COMMIT;
