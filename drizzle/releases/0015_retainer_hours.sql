CREATE TABLE "retainer_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"retainer_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retainer_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"period_id" text NOT NULL,
	"time_entry_id" text,
	"source_entry_id" text,
	"minutes" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"started_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_entries_time_entry_id_unique" UNIQUE("time_entry_id"),
	CONSTRAINT "retainer_entry_valid" CHECK ("retainer_entries"."minutes"<>0 and (("retainer_entries"."kind"='time' and "retainer_entries"."minutes">0 and "retainer_entries"."time_entry_id" is not null and "retainer_entries"."source_entry_id" is null) or ("retainer_entries"."kind"='adjustment' and "retainer_entries"."time_entry_id" is null and "retainer_entries"."source_entry_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "retainer_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"retainer_id" text NOT NULL,
	"month" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"included_minutes" integer NOT NULL,
	"carry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"statement" jsonb,
	"decision" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	CONSTRAINT "retainer_period_month_key" UNIQUE("retainer_id","month"),
	CONSTRAINT "retainer_period_valid" CHECK ("retainer_periods"."ends_at">"retainer_periods"."starts_at" and "retainer_periods"."state" in ('open','closed') and "retainer_periods"."included_minutes">=0)
);
--> statement-breakpoint
CREATE TABLE "retainers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"monthly_amount" numeric(10, 2) NOT NULL,
	"included_minutes" integer NOT NULL,
	"timezone" text NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text,
	"renewal" text NOT NULL,
	"carry_policy" text NOT NULL,
	"carry_cap" integer NOT NULL,
	"carry_months" integer NOT NULL,
	"overage_policy" text NOT NULL,
	"overage_rate" numeric(10, 2) NOT NULL,
	"recurring_id" text,
	"state" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainers_recurring_id_unique" UNIQUE("recurring_id"),
	CONSTRAINT "retainers_valid" CHECK ("retainers"."included_minutes" >= 0 and "retainers"."monthly_amount" >= 0 and "retainers"."carry_cap" >= 0 and "retainers"."carry_months" between 0 and 12 and "retainers"."overage_rate" >= 0 and "retainers"."state" in ('active','paused','cancelled') and "retainers"."renewal" in ('manual','automatic') and "retainers"."carry_policy" in ('expire','carry') and "retainers"."overage_policy" in ('waive','approval'))
);
--> statement-breakpoint
ALTER TABLE "retainer_commands" ADD CONSTRAINT "retainer_commands_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_entries" ADD CONSTRAINT "retainer_entries_period_id_retainer_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."retainer_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_entries" ADD CONSTRAINT "retainer_entries_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_periods" ADD CONSTRAINT "retainer_periods_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_recurring_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_entries_period_idx" ON "retainer_entries" USING btree ("period_id","created_at");--> statement-breakpoint
CREATE INDEX "retainers_client_idx" ON "retainers" USING btree ("organization_id","client_id");

-- A timer can back exactly one commercial source, even through legacy write paths.
CREATE FUNCTION retainer_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p retainer_periods%ROWTYPE; t time_entries%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Retainer entries are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM retainer_periods WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.period_id ELSE NEW.period_id END FOR UPDATE;
 IF p.state IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Retainer period is closed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.time_entry_id IS NOT NULL THEN
  SELECT * INTO t FROM time_entries WHERE id=NEW.time_entry_id FOR UPDATE;
  IF t.id IS NULL OR t.status<>'completed' OR t.billable IS DISTINCT FROM true OR t.duration IS DISTINCT FROM NEW.minutes
   OR t.end_time IS NULL OR t.start_time AT TIME ZONE 'UTC'<p.starts_at OR t.start_time AT TIME ZONE 'UTC'>=p.ends_at OR t.end_time AT TIME ZONE 'UTC'>p.ends_at
   OR EXISTS(SELECT 1 FROM invoice_time_items WHERE time_entry_id=t.id)
   OR NOT EXISTS(SELECT 1 FROM retainers r JOIN projects pr ON pr.id=t.project_id AND pr.organization_id=r.organization_id AND pr.client_id=r.client_id WHERE r.id=p.retainer_id AND r.state='active' AND (t.client_id IS NULL OR t.client_id=r.client_id))
  THEN RAISE EXCEPTION 'Time is no longer eligible' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retainer_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON retainer_entries FOR EACH ROW EXECUTE FUNCTION retainer_entry_guard();
CREATE FUNCTION retainer_time_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM retainer_entries WHERE time_entry_id=OLD.id) AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')) THEN
  RAISE EXCEPTION 'Time allocated to a contract cannot be edited; remove open allocation or record a closed-period adjustment' USING ERRCODE='23503',CONSTRAINT='invoice_time_items_time_entry_id_retainer';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER time_entries_retainer_guard BEFORE UPDATE OR DELETE ON time_entries FOR EACH ROW EXECUTE FUNCTION retainer_time_guard();
CREATE FUNCTION retainer_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM time_entries WHERE id=NEW.time_entry_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM retainer_entries WHERE time_entry_id=NEW.time_entry_id) THEN RAISE EXCEPTION 'Time already allocated to a contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_time_retainer_guard BEFORE INSERT OR UPDATE ON invoice_time_items FOR EACH ROW EXECUTE FUNCTION retainer_invoice_guard();
CREATE FUNCTION retainer_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retainer statements cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-ARRAY['state','revision','statement','decision','decided_by','decided_at','decision_note','closed_at','closed_by']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','revision','statement','decision','decided_by','decided_at','decision_note','closed_at','closed_by']) THEN RAISE EXCEPTION 'Period terms are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='closed' AND ((to_jsonb(OLD)-ARRAY['revision','decision','decided_by','decided_at','decision_note']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revision','decision','decided_by','decided_at','decision_note'])) THEN RAISE EXCEPTION 'Closed statement is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='closed' AND (OLD.decision,OLD.decided_by,OLD.decided_at,OLD.decision_note) IS DISTINCT FROM (NEW.decision,NEW.decided_by,NEW.decided_at,NEW.decision_note) AND (OLD.decision<>'awaiting' OR NEW.decision NOT IN ('approved','rejected') OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL) THEN RAISE EXCEPTION 'Decision is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retainer_periods_guard BEFORE UPDATE OR DELETE ON retainer_periods FOR EACH ROW EXECUTE FUNCTION retainer_period_guard();
CREATE FUNCTION retainer_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancel contracts instead of deleting' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-ARRAY['state','revision']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','revision']) OR (OLD.state='cancelled' AND NEW.state<>'cancelled') THEN RAISE EXCEPTION 'Contract terms are immutable; create a replacement contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retainers_terms_guard BEFORE UPDATE OR DELETE ON retainers FOR EACH ROW EXECUTE FUNCTION retainer_terms_guard();
CREATE FUNCTION retainer_recurring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM retainers WHERE recurring_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring template belongs to a contract' USING ERRCODE='23514'; END IF;
  IF (OLD.amount,OLD.client_id,OLD.organization_id,OLD.frequency) IS DISTINCT FROM (NEW.amount,NEW.client_id,NEW.organization_id,NEW.frequency) OR (NEW.status='active' AND EXISTS(SELECT 1 FROM retainers WHERE recurring_id=OLD.id AND state<>'active')) THEN RAISE EXCEPTION 'Recurring terms belong to a contract' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER recurring_retainer_guard BEFORE UPDATE OR DELETE ON recurring_invoices FOR EACH ROW EXECUTE FUNCTION retainer_recurring_guard();
