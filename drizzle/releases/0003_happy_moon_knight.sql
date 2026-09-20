ALTER TABLE "job_schedules" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD COLUMN "interval_minutes" integer;