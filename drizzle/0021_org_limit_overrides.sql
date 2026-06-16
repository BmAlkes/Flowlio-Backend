-- Add per-org limit override columns to organizations table
-- These take precedence over plan-level limits (null = follow plan)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS override_max_leads integer,
  ADD COLUMN IF NOT EXISTS override_max_clients integer,
  ADD COLUMN IF NOT EXISTS override_max_webhooks integer,
  ADD COLUMN IF NOT EXISTS override_max_tasks integer,
  ADD COLUMN IF NOT EXISTS override_max_invoices integer,
  ADD COLUMN IF NOT EXISTS override_max_proposals integer,
  ADD COLUMN IF NOT EXISTS override_ai_token_limit integer;
