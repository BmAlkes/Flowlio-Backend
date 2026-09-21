CREATE TABLE "delivery_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"milestone_id" text,
	"client_id" text,
	"source_version" text NOT NULL,
	"title" text NOT NULL,
	"due_date" timestamp,
	"note" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "delivery_reviews_source_unique" UNIQUE("project_id","milestone_id","client_id","source_version")
);
--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_reviews" ADD CONSTRAINT "delivery_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_reviews_project_idx" ON "delivery_reviews" USING btree ("project_id","requested_at");