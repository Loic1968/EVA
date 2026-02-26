-- Web Push subscriptions for browser/phone notifications
CREATE TABLE IF NOT EXISTS eva.push_subscriptions (
  id                SERIAL PRIMARY KEY,
  owner_id          INT NOT NULL REFERENCES eva.owners(id) ON DELETE CASCADE,
  endpoint           TEXT NOT NULL,
  p256dh            TEXT,
  auth               TEXT,
  user_agent        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner ON eva.push_subscriptions(owner_id);

COMMENT ON TABLE eva.push_subscriptions IS 'Web Push subscriptions for browser/phone notifications (important emails, calendar reminders)';
