-- Migration 0019: Add webhook source columns to clients table

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "webhook_id"   text REFERENCES "lead_webhooks"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "webhook_name" text;

CREATE INDEX IF NOT EXISTS "clients_webhook_id_idx" ON "clients" ("webhook_id");
