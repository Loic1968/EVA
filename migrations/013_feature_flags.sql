-- Runtime feature flags (Settings > Control > Runtime flags). Used by featureFlagService.
BEGIN;

CREATE TABLE IF NOT EXISTS eva.feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMIT;
