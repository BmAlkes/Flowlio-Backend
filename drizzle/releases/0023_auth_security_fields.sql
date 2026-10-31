-- Additive upgrade for Better Auth 1.7 two-factor verification and lockout.
-- Existing factors keep their previously verified state.
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "verified" boolean NOT NULL DEFAULT true;
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;

-- Admin-plugin fields: neutral defaults preserve existing users and sessions.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_reason" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;
