-- Migration: Add passwordChanged field to demo organization settings
-- This migration updates existing demo organizations to include the passwordChanged field
-- Since settings is a JSON column, no schema change is needed, but we'll update existing data

-- Update existing demo organizations to set passwordChanged to false if not already set
-- This ensures all demo accounts require password change on first login
UPDATE organizations
SET settings = jsonb_set(
    COALESCE(settings::jsonb, '{}'::jsonb),
    '{passwordChanged}',
    'false'::jsonb,
    true
)
WHERE (settings->>'demo')::boolean = true
  AND (settings->>'passwordChanged') IS NULL;

-- For demo organizations that don't have the passwordChanged field yet,
-- ensure it's set to false for new accounts
-- Note: This is handled in the application code when creating demo accounts

