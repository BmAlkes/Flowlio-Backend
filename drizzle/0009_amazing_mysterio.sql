ALTER TABLE "tasks" ADD COLUMN "start_after" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "finish_before" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_organization_owner" boolean;