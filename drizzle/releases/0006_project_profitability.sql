CREATE TABLE "project_financial_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"hourly_cost" numeric(10, 2),
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_financial_settings" ADD CONSTRAINT "project_financial_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_financial_settings" ADD CONSTRAINT "project_financial_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;