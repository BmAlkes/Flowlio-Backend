-- Migration 0017: Create lead_field_definitions table
-- Custom field definitions per workspace for leads

CREATE TABLE IF NOT EXISTS "lead_field_definitions" (
  "id"         text PRIMARY KEY,
  "org_id"     text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "type"       text NOT NULL,
  "options"    jsonb,
  "required"   boolean DEFAULT false,
  "position"   integer DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lead_field_definitions_org_idx"
  ON "lead_field_definitions" ("org_id");
