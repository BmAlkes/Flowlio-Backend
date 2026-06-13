-- Migration 0018: Create lead_webhooks and lead_webhook_logs tables

CREATE TABLE IF NOT EXISTS "lead_webhooks" (
  "id"            text PRIMARY KEY,
  "org_id"        text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  "source"        text NOT NULL,
  "token"         text UNIQUE NOT NULL,
  "active"        boolean DEFAULT true,
  "field_mapping" jsonb DEFAULT '{}',
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lead_webhooks_org_idx"
  ON "lead_webhooks" ("org_id");

CREATE TABLE IF NOT EXISTS "lead_webhook_logs" (
  "id"         text PRIMARY KEY,
  "webhook_id" text NOT NULL REFERENCES "lead_webhooks"("id") ON DELETE CASCADE,
  "status"     text NOT NULL,
  "payload"    jsonb,
  "lead_id"    text,
  "error"      text,
  "ip"         text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lead_webhook_logs_webhook_idx"
  ON "lead_webhook_logs" ("webhook_id");

CREATE INDEX IF NOT EXISTS "lead_webhook_logs_created_at_idx"
  ON "lead_webhook_logs" ("created_at");
