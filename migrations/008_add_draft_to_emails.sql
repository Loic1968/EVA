-- Add to_emails to drafts for Gmail send (recipient)
ALTER TABLE eva.drafts ADD COLUMN IF NOT EXISTS to_emails TEXT;
COMMENT ON COLUMN eva.drafts.to_emails IS 'Comma-separated recipient emails for Gmail send; for replies, can be derived from thread';
