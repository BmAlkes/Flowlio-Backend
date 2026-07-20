ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "portal_access_enabled" boolean NOT NULL DEFAULT true;
