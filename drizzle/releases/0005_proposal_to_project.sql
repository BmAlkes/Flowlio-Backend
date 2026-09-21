CREATE TABLE "proposal_project_conversions" (
	"source_id" text PRIMARY KEY NOT NULL,
	"proposal_id" text,
	"project_id" text,
	"organization_id" text NOT NULL,
	"created_by" text,
	"source_version" text NOT NULL,
	"source_title" text NOT NULL,
	"template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_project_conversions" ADD CONSTRAINT "proposal_project_conversions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_project_conversions" ADD CONSTRAINT "proposal_project_conversions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_project_conversions" ADD CONSTRAINT "proposal_project_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_project_conversions" ADD CONSTRAINT "proposal_project_conversions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_project_conversions_org_idx" ON "proposal_project_conversions" USING btree ("organization_id");