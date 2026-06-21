-- Add endpoint and durationMs columns to ai_usage_logs
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

-- Add status index for filtering errors
CREATE INDEX IF NOT EXISTS ai_usage_logs_status_idx ON ai_usage_logs(status);
