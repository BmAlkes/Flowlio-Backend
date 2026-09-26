CREATE TABLE "ai_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_scope" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"apply_hash" text,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_runs_state_check" CHECK ("ai_agent_runs"."state" in ('running','ready','applied','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_runs_author_idx" ON "ai_agent_runs" USING btree ("organization_id","actor_id","created_at");