CREATE TABLE "durable_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" json DEFAULT '{}'::json NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "durable_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"kind" text PRIMARY KEY NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "durable_jobs_due_idx" ON "durable_jobs" USING btree ("status","available_at");