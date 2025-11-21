ALTER TABLE "users" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "selected_plan_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pending_organization_data" json;