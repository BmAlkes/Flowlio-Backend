CREATE TABLE "scope_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"client_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" jsonb,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"cancellation_reason" text,
	"application" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_changes_state_check" CHECK ("scope_change_requests"."state" in ('requested','analysis','awaiting','approved','rejected','applied','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "scope_change_versions" (
	"change_id" text NOT NULL,
	"revision" integer NOT NULL,
	"classification" text NOT NULL,
	"estimated_hours" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"end_date" text,
	"base_end_date" timestamp,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" text,
	"comment" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "scope_change_versions_change_id_revision_pk" PRIMARY KEY("change_id","revision"),
	CONSTRAINT "scope_versions_amount_check" CHECK ("scope_change_versions"."amount" >= 0 and "scope_change_versions"."estimated_hours" >= 0 and ("scope_change_versions"."classification" = 'additional' or ("scope_change_versions"."classification" = 'included' and "scope_change_versions"."amount" = 0)))
);
--> statement-breakpoint
ALTER TABLE "scope_change_requests" ADD CONSTRAINT "scope_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_change_requests" ADD CONSTRAINT "scope_change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_change_versions" ADD CONSTRAINT "scope_change_versions_change_id_scope_change_requests_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."scope_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scope_changes_project_idx" ON "scope_change_requests" USING btree ("organization_id","project_id","created_at");
-- Estimates are immutable; a commercial revision always creates another row.
CREATE FUNCTION public.flowlio_scope_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['decision','comment','decided_by','decided_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['decision','comment','decided_by','decided_at'])
 OR (OLD.decision IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
  RAISE EXCEPTION 'Scope estimate versions and completed decisions are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_version_immutable BEFORE UPDATE ON public.scope_change_versions FOR EACH ROW EXECUTE FUNCTION public.flowlio_scope_version_guard();
