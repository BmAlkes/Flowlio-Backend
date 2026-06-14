CREATE TABLE IF NOT EXISTS "user_onboarding" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "user_id"      TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "role"         TEXT NOT NULL,
  "dismissed"    BOOLEAN NOT NULL DEFAULT false,
  "dismissed_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "steps"        JSON NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_onboarding_user_idx" ON "user_onboarding" ("user_id");
CREATE INDEX IF NOT EXISTS "user_onboarding_role_idx" ON "user_onboarding" ("role");
