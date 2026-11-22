-- Additive (LGPD): record terms/privacy acceptance on signup, mark anonymized accounts,
-- and keep a log of data subject requests (export / deletion) as proof of compliance.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "privacy_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"organization_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "privacy_requests_type_check" CHECK ("type" in ('export','deletion')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("status" in ('pending','completed','rejected'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_user_idx" ON "privacy_requests" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_status_idx" ON "privacy_requests" USING btree ("status","requested_at");
