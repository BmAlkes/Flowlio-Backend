-- Explicit project links: existing contracts and historical hours are unchanged.
CREATE TABLE retainer_project_links (
 project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 retainer_id text NOT NULL REFERENCES retainers(id),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE retainer_periods ADD COLUMN carry_pending boolean NOT NULL DEFAULT false;
ALTER TABLE client_requests ADD COLUMN review_required boolean NOT NULL DEFAULT true;

CREATE FUNCTION ensure_retainer_month(contract_id text, month_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r retainers%ROWTYPE; previous retainer_periods%ROWTYPE; result text; cursor_month text; pending boolean;
BEGIN
 SELECT * INTO r FROM retainers WHERE id=contract_id;
 IF r.id IS NULL OR r.state<>'active' OR month_key<r.start_month OR (r.end_month IS NOT NULL AND month_key>r.end_month) THEN RETURN NULL; END IF;
 SELECT id INTO result FROM retainer_periods WHERE retainer_id=r.id AND month=month_key;
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF r.renewal<>'automatic' THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('time-invoice:'||r.organization_id,0));
 SELECT * INTO r FROM retainers WHERE id=contract_id FOR UPDATE;
 SELECT * INTO previous FROM retainer_periods WHERE retainer_id=r.id ORDER BY month DESC LIMIT 1;
 IF previous.month>month_key THEN RETURN NULL; END IF;
 cursor_month:=coalesce(to_char((previous.month||'-01')::date+interval '1 month','YYYY-MM'),r.start_month);
 -- Only add missing months; never close or invoice a period here.
 WHILE cursor_month<=month_key LOOP
  pending:=previous.id IS NOT NULL AND previous.state<>'closed';
  INSERT INTO retainer_periods(id,retainer_id,month,starts_at,ends_at,included_minutes,carry,carry_pending)
  VALUES(gen_random_uuid()::text,r.id,cursor_month,(cursor_month||'-01')::timestamp AT TIME ZONE r.timezone,
   ((cursor_month||'-01')::date+interval '1 month') AT TIME ZONE r.timezone,r.included_minutes,
   CASE WHEN pending THEN '[]'::jsonb ELSE coalesce(previous.statement->'carryOut','[]'::jsonb) END,pending)
  ON CONFLICT(retainer_id,month) DO NOTHING;
  SELECT * INTO previous FROM retainer_periods WHERE retainer_id=r.id AND month=cursor_month;
  result:=previous.id;
  cursor_month:=to_char((cursor_month||'-01')::date+interval '1 month','YYYY-MM');
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION auto_retainer_time() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r retainers%ROWTYPE; pr projects%ROWTYPE; link retainer_project_links%ROWTYPE; p retainer_periods%ROWTYPE; period_id text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status,NEW.billable,NEW.duration,NEW.start_time,NEW.end_time,NEW.project_id,NEW.client_id) IS NOT DISTINCT FROM (OLD.status,OLD.billable,OLD.duration,OLD.start_time,OLD.end_time,OLD.project_id,OLD.client_id) THEN RETURN NEW; END IF;
 IF NEW.status<>'completed' OR NEW.billable IS DISTINCT FROM true OR coalesce(NEW.duration,0)<=0 OR NEW.end_time IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO link FROM retainer_project_links WHERE project_id=NEW.project_id;
 IF link.project_id IS NULL OR NEW.start_time AT TIME ZONE 'UTC'<link.created_at THEN RETURN NEW; END IF;
 SELECT * INTO pr FROM projects WHERE id=NEW.project_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('time-invoice:'||pr.organization_id,0));
 SELECT * INTO r FROM retainers WHERE id=link.retainer_id FOR UPDATE;
 IF r.state<>'active' OR r.organization_id<>pr.organization_id OR r.client_id IS DISTINCT FROM pr.client_id
  OR pr.currency_code IS DISTINCT FROM r.currency OR (NEW.client_id IS NOT NULL AND NEW.client_id<>r.client_id)
  OR EXISTS(SELECT 1 FROM invoice_time_items WHERE time_entry_id=NEW.id)
  OR EXISTS(SELECT 1 FROM retainer_entries WHERE time_entry_id=NEW.id) THEN RETURN NEW; END IF;
 period_id:=ensure_retainer_month(r.id,to_char(NEW.start_time AT TIME ZONE 'UTC' AT TIME ZONE r.timezone,'YYYY-MM'));
 SELECT * INTO p FROM retainer_periods WHERE id=period_id;
 IF p.id IS NULL OR p.state<>'open' OR NEW.end_time AT TIME ZONE 'UTC'>p.ends_at THEN RETURN NEW; END IF;
 INSERT INTO retainer_entries(id,period_id,time_entry_id,minutes,kind,label,started_at,created_by)
 VALUES(gen_random_uuid()::text,p.id,NEW.id,NEW.duration,'time',pr.name,NEW.start_time AT TIME ZONE 'UTC',NEW.user_id);
 UPDATE retainer_periods SET revision=revision+1 WHERE id=p.id;
 INSERT INTO business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,operation_id,changes)
 VALUES(gen_random_uuid()::text,r.organization_id,'system',NULL,'retainer.allocated','retainer',r.id,gen_random_uuid()::text,
  jsonb_build_object('period_id',jsonb_build_object('before',NULL,'after',p.id),'minutes',jsonb_build_object('before',NULL,'after',NEW.duration)));
 RETURN NEW;
END $$;
CREATE TRIGGER time_entries_auto_retainer AFTER INSERT OR UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION auto_retainer_time();

-- Carry can be settled only while the destination month remains open.
CREATE OR REPLACE FUNCTION retainer_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retainer statements cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(OLD)-ARRAY['state','revision','statement','decision','decided_by','decided_at','decision_note','closed_at','closed_by','carry','carry_pending']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','revision','statement','decision','decided_by','decided_at','decision_note','closed_at','closed_by','carry','carry_pending']) THEN RAISE EXCEPTION 'Period terms are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='closed' AND ((to_jsonb(OLD)-ARRAY['revision','decision','decided_by','decided_at','decision_note']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revision','decision','decided_by','decided_at','decision_note'])) THEN RAISE EXCEPTION 'Closed statement is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='closed' AND (OLD.decision,OLD.decided_by,OLD.decided_at,OLD.decision_note) IS DISTINCT FROM (NEW.decision,NEW.decided_by,NEW.decided_at,NEW.decision_note) AND (OLD.decision<>'awaiting' OR NEW.decision NOT IN ('approved','rejected') OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL) THEN RAISE EXCEPTION 'Decision is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

ALTER TABLE invoices ADD COLUMN commercial_source text UNIQUE;
ALTER TABLE invoices ADD COLUMN project_id text REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE delivery_reviews ADD COLUMN complete_milestone boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_reviews ADD COLUMN completed_version text;
