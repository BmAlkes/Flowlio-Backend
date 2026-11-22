-- Additive: follow-up emails to unfinished signups (no plan chosen or payment not completed) and their one-click answers.
CREATE TABLE IF NOT EXISTS "signup_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stage" text NOT NULL,
	"sent_by" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"answered_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	CONSTRAINT "signup_followups_stage_check" CHECK ("signup_followups"."stage" in ('no_plan','checkout')),
	CONSTRAINT "signup_followups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_followups_user_idx" ON "signup_followups" USING btree ("user_id","sent_at");
