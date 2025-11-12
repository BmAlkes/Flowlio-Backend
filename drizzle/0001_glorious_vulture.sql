CREATE TABLE "recent_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"actor_id" text,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"message" text,
	"metadata" json,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recent_activities_org_idx" ON "recent_activities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recent_activities_actor_idx" ON "recent_activities" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "recent_activities_type_idx" ON "recent_activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "recent_activities_res_idx" ON "recent_activities" USING btree ("resource");