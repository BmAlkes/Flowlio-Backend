CREATE TABLE "attention_preferences" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"approval_days" integer DEFAULT 7 NOT NULL,
	"proposal_days" integer DEFAULT 14 NOT NULL,
	"unbilled_minutes" integer DEFAULT 60 NOT NULL,
	"budget_percent" integer DEFAULT 80 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attention_triage" (
	"organization_id" text NOT NULL,
	"source_key" text NOT NULL,
	"source_revision" text NOT NULL,
	"assignee_id" text,
	"snoozed_until" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_triage_organization_id_source_key_pk" PRIMARY KEY("organization_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "attention_preferences" ADD CONSTRAINT "attention_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_preferences" ADD CONSTRAINT "attention_preferences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_triage" ADD CONSTRAINT "attention_triage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_triage" ADD CONSTRAINT "attention_triage_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_triage" ADD CONSTRAINT "attention_triage_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;