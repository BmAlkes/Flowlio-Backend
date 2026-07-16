-- Automation run history: one row per cron or manual execution
CREATE TABLE IF NOT EXISTS automation_runs (
  id              text PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  automation_key  text NOT NULL,
  items_found     integer DEFAULT 0,
  emails_sent     integer DEFAULT 0,
  emails_failed   integer DEFAULT 0,
  errors          json,
  triggered_by    text NOT NULL,
  run_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_runs_org_key_idx ON automation_runs(organization_id, automation_key);
CREATE INDEX IF NOT EXISTS automation_runs_run_at_idx  ON automation_runs(run_at);

-- Per-org automation configuration: enabled flag + custom schedule hour
CREATE TABLE IF NOT EXISTS automation_settings (
  id                   text PRIMARY KEY,
  organization_id      text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  automation_key       text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  schedule_hour_utc    integer,
  last_scheduled_run_at timestamp,
  CONSTRAINT automation_settings_org_key UNIQUE (organization_id, automation_key)
);

CREATE INDEX IF NOT EXISTS automation_settings_org_idx ON automation_settings(organization_id);

-- New columns on invoices for overdue repeat-notification guard
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS overdue_notified_at timestamp;

-- New columns on payment_links for smart-link model + reminder guard
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS external_payment_url text;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS status text DEFAULT 'unpaid';
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS reminder_notified_at timestamp;
