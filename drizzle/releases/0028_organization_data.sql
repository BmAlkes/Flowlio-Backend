-- Additive: per-organization backups (gzip JSON snapshots used to restore one organization alone)
-- and tracking of inactive organizations for automatic deletion after 90 days (Terms of Service, LGPD).
CREATE TABLE IF NOT EXISTS "organization_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text,
	"schema_version" integer NOT NULL,
	"table_count" integer NOT NULL,
	"row_count" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_backups_kind_check" CHECK ("organization_backups"."kind" in ('scheduled','manual','pre_restore')),
	CONSTRAINT "organization_backups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_backups_org_idx" ON "organization_backups" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "inactive_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deletion_warning_sent_at" timestamp with time zone;
