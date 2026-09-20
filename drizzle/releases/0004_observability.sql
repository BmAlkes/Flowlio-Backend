CREATE TABLE "operational_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"route" text NOT NULL,
	"correlation_id" text NOT NULL,
	"release" text NOT NULL,
	"status" integer,
	"duration_ms" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_metrics" (
	"scope" text NOT NULL,
	"source" text NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"requests" integer NOT NULL,
	"errors" integer NOT NULL,
	"duration_ms" bigint NOT NULL,
	"max_duration_ms" integer NOT NULL,
	CONSTRAINT "operational_metrics_scope_source_bucket_at_pk" PRIMARY KEY("scope","source","bucket_at")
);
--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_events_org_time_idx" ON "operational_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operational_events_time_idx" ON "operational_events" USING btree ("occurred_at");