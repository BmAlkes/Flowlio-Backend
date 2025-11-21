-- Migration: Set default values and update existing users
-- This migration safely updates the users table without disturbing existing data
-- Run this AFTER migration 0008_dazzling_the_enforcers.sql

-- Step 1: Update all existing users to 'active' status (they're already in the system)
-- This ensures no existing users are blocked from logging in
UPDATE "users" 
SET "status" = 'active' 
WHERE "status" IS NULL OR "status" = '';

-- Step 2: Set default value for status column for future inserts
-- New users will default to 'pending' status (until payment is completed)
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'pending';

-- Note: selected_plan_id and pending_organization_data are already nullable
-- No additional action needed for these columns

-- Summary:
-- ✅ Existing users: All set to 'active' status (no disruption)
-- ✅ New users: Will default to 'pending' status (until payment)
-- ✅ No data loss or disruption to existing functionality

