ALTER TABLE workflow_rules ADD COLUMN action_type text NOT NULL DEFAULT 'notify',
 ADD COLUMN recipient_id text, ADD COLUMN channel text NOT NULL DEFAULT 'internal', ADD COLUMN target_project_id text;
UPDATE workflow_rules SET recipient_id=created_by;
ALTER TABLE workflow_rules ADD CONSTRAINT workflow_action_valid CHECK(action_type IN ('notify','create_task','assign_project','prepare_billing') AND channel IN ('internal','email','push'));
ALTER TABLE workflow_executions ADD COLUMN resource_type text, ADD COLUMN resource_id text, ADD COLUMN details jsonb,
 ADD COLUMN job_id text, ADD COLUMN attempts integer NOT NULL DEFAULT 1;
CREATE TABLE workflow_events (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 trigger text NOT NULL, project_id text, client_id text, source_id text NOT NULL, revision integer,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workflow_events_scan ON workflow_events(organization_id,trigger,occurred_at,id);
CREATE TABLE workflow_billing_drafts (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 source_type text NOT NULL, source_id text NOT NULL, revision integer NOT NULL,
 amount numeric(10,2) NOT NULL CHECK(amount>0), currency text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT workflow_billing_source_key UNIQUE(organization_id,source_type,source_id,revision)
);
CREATE FUNCTION workflow_milestone_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
  INSERT INTO workflow_events(id,organization_id,trigger,project_id,source_id)
   VALUES(gen_random_uuid()::text,NEW.organization_id,'milestone_completed',NEW.project_id,NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER milestones_workflow_event AFTER UPDATE ON project_milestones FOR EACH ROW EXECUTE FUNCTION workflow_milestone_event();
CREATE FUNCTION workflow_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period record; allowance bigint; consumed bigint; threshold integer; period_key text;
BEGIN
 IF NEW.resource_type='change_request' AND NEW.action='change_request.approved' THEN
  INSERT INTO workflow_events(id,organization_id,trigger,project_id,client_id,source_id,revision)
   SELECT NEW.id,NEW.organization_id,'scope_approved',r.project_id,r.client_id,r.id,r.revision
   FROM scope_change_requests r WHERE r.id=NEW.resource_id AND r.organization_id=NEW.organization_id;
 ELSIF NEW.resource_type='retainer' AND NEW.action IN ('retainer.allocated','retainer.adjusted','retainer.closed','retainer.decided') THEN
  period_key := NEW.changes->'period_id'->>'after';
  SELECT p.*,r.client_id,r.organization_id INTO period FROM retainer_periods p JOIN retainers r ON r.id=p.retainer_id
   WHERE p.id=period_key AND r.id=NEW.resource_id AND r.organization_id=NEW.organization_id;
  IF FOUND THEN
   IF NEW.action='retainer.decided' AND period.decision='approved' THEN
    INSERT INTO workflow_events(id,organization_id,trigger,client_id,source_id)
     VALUES('overage:'||period.id,NEW.organization_id,'retainer_overage_approved',period.client_id,period.id) ON CONFLICT DO NOTHING;
   ELSIF NEW.action='retainer.closed' THEN
    INSERT INTO workflow_events(id,organization_id,trigger,client_id,source_id)
     VALUES('closed:'||period.id,NEW.organization_id,'retainer_closed',period.client_id,period.id) ON CONFLICT DO NOTHING;
   ELSIF NEW.action IN ('retainer.allocated','retainer.adjusted') THEN
    SELECT period.included_minutes+coalesce(sum((lot->>'minutes')::bigint),0) INTO allowance FROM jsonb_array_elements(period.carry) lot;
    SELECT coalesce(sum(minutes),0) INTO consumed FROM retainer_entries WHERE period_id=period.id;
    FOREACH threshold IN ARRAY ARRAY[80,100] LOOP
     IF allowance>0 AND consumed*100>=allowance*threshold THEN
      INSERT INTO workflow_events(id,organization_id,trigger,client_id,source_id)
       VALUES('consumption:'||period.id||':'||threshold,NEW.organization_id,'retainer_'||threshold,period.client_id,period.id) ON CONFLICT DO NOTHING;
     END IF;
    END LOOP;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_workflow_event AFTER INSERT ON business_audit_events FOR EACH ROW EXECUTE FUNCTION workflow_audit_event();
