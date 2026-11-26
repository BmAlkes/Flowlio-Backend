CREATE TABLE "task_automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text,
	"run_key" text NOT NULL,
	"outcome" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "task_events_kind_check" CHECK ("task_events"."kind" in ('created','updated'))
);
--> statement-breakpoint
ALTER TABLE "task_automation_rules" ADD CONSTRAINT "task_automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_rules" ADD CONSTRAINT "task_automation_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_rules" ADD CONSTRAINT "task_automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_runs" ADD CONSTRAINT "task_automation_runs_rule_id_task_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."task_automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_runs" ADD CONSTRAINT "task_automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_automation_rules_org_idx" ON "task_automation_rules" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "task_automation_runs_once" ON "task_automation_runs" USING btree ("rule_id","run_key");--> statement-breakpoint
CREATE INDEX "task_automation_runs_history_idx" ON "task_automation_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "task_events_pending_idx" ON "task_events" USING btree ("id") WHERE "task_events"."processed_at" is null;--> statement-breakpoint
-- Records task changes for organizations that have automations. Depth comes from the automation that made the change (0 for people), so chains stop after a few steps.
CREATE OR REPLACE FUNCTION flowlio_task_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  org text;
  delta jsonb := '{}'::jsonb;
  chain integer;
BEGIN
  SELECT organization_id INTO org FROM projects WHERE id = NEW.project_id;
  IF org IS NULL OR NOT EXISTS (SELECT 1 FROM task_automation_rules r WHERE r.organization_id = org AND r.enabled) THEN
    RETURN NULL;
  END IF;
  chain := coalesce(nullif(current_setting('flowlio.automation_depth', true), ''), '0')::integer;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_events (organization_id, task_id, project_id, kind, changes, depth) VALUES (org, NEW.id, NEW.project_id, 'created', '{}'::jsonb, chain);
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    delta := delta || jsonb_build_object('status', jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    delta := delta || jsonb_build_object('assignee', jsonb_build_object('from', OLD.assigned_to, 'to', NEW.assigned_to));
  END IF;
  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    delta := delta || jsonb_build_object('dueDate', jsonb_build_object('from', OLD.end_date, 'to', NEW.end_date));
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    delta := delta || jsonb_build_object('project', jsonb_build_object('from', OLD.project_id, 'to', NEW.project_id));
  END IF;
  IF NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN
    delta := delta || jsonb_build_object('fields', (
      SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('from', OLD.custom_fields -> k, 'to', NEW.custom_fields -> k)), '{}'::jsonb)
      FROM (SELECT jsonb_object_keys(coalesce(OLD.custom_fields, '{}'::jsonb)) AS k UNION SELECT jsonb_object_keys(coalesce(NEW.custom_fields, '{}'::jsonb))) AS keys
      WHERE OLD.custom_fields -> k IS DISTINCT FROM NEW.custom_fields -> k));
  END IF;
  IF delta = '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  INSERT INTO task_events (organization_id, task_id, project_id, kind, changes, depth) VALUES (org, NEW.id, NEW.project_id, 'updated', delta, chain);
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tasks_automation_events ON tasks;--> statement-breakpoint
CREATE TRIGGER tasks_automation_events AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION flowlio_task_automation_event();
