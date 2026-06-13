-- Migration 0016: Add type column to clients table
-- Run this on Railway before deploying the lead/client separation feature

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'lead';

-- Convert existing records based on status
UPDATE "clients"
  SET "type" = 'client'
  WHERE "status" IN ('Contract Signed', 'Project In Progress', 'Completed');

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS "clients_type_idx" ON "clients" ("type");
