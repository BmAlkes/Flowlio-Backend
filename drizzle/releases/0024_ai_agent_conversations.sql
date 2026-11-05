-- Additive: group agent runs into conversations so follow-up requests keep context.
-- Existing runs stay NULL (standalone requests).
ALTER TABLE "ai_agent_runs" ADD COLUMN IF NOT EXISTS "conversation_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_conversation_idx" ON "ai_agent_runs" USING btree ("organization_id","actor_id","conversation_id","created_at");
