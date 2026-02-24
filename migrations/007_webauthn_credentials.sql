-- WebAuthn / Passkey credentials for passwordless login
BEGIN;

CREATE TABLE IF NOT EXISTS eva.webauthn_credentials (
  id              SERIAL PRIMARY KEY,
  owner_id        INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  credential_id   TEXT NOT NULL,
  public_key      BYTEA NOT NULL,
  counter         BIGINT NOT NULL DEFAULT 0,
  device_type     TEXT,
  backed_up       BOOLEAN DEFAULT false,
  transports      TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_owner ON eva.webauthn_credentials(owner_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON eva.webauthn_credentials(credential_id);

COMMIT;
