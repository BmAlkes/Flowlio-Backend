-- Webhook retry system
ALTER TABLE lead_webhook_logs ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE lead_webhook_logs ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE lead_webhook_logs ADD COLUMN IF NOT EXISTS max_retries integer DEFAULT 3;

CREATE INDEX IF NOT EXISTS lead_webhook_logs_retry_idx ON lead_webhook_logs(status, next_retry_at);
