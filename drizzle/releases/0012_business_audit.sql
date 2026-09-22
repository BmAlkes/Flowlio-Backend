CREATE TABLE "business_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"project_id" text,
	"operation_id" text NOT NULL,
	"changes" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "business_audit_org_time_idx" ON "business_audit_events" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "business_audit_resource_time_idx" ON "business_audit_events" USING btree ("organization_id","resource_type","resource_id","occurred_at");--> statement-breakpoint
CREATE INDEX "business_audit_operation_idx" ON "business_audit_events" USING btree ("organization_id","operation_id");
-- Audited values are selected explicitly. Never persist the whole source row.
CREATE FUNCTION public.flowlio_business_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  source jsonb := CASE WHEN TG_OP = 'DELETE' THEN previous ELSE current_row END;
  context jsonb := coalesce(nullif(current_setting('flowlio.audit_context', true), ''), '{}')::jsonb;
  fields text[];
  field text;
  before_value jsonb;
  after_value jsonb;
  differences jsonb := '{}'::jsonb;
  kind text := 'unknown';
  actor text;
  operation text := 'database:' || txid_current()::text;
  resource text;
  project text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'projects' THEN
      fields := ARRAY['budget', 'start_date', 'end_date', 'status', 'visibility', 'assigned_to'];
      resource := 'project'; project := source->>'id';
    WHEN 'delivery_reviews' THEN
      fields := ARRAY['state', 'source_version', 'milestone_id', 'client_id'];
      resource := 'delivery_review'; project := source->>'project_id';
    WHEN 'user_organizations' THEN
      fields := ARRAY['role', 'status', 'permissions']; resource := 'organization_membership';
    WHEN 'user_management' THEN
      fields := ARRAY['userrole']; resource := 'organization_member';
    ELSE RAISE EXCEPTION 'Unsupported business audit source';
  END CASE;
  FOREACH field IN ARRAY fields LOOP
    before_value := coalesce(previous->field, 'null'::jsonb);
    after_value := coalesce(current_row->field, 'null'::jsonb);
    IF field = 'permissions' THEN
      -- Only known permission booleans: arbitrary JSON keys cannot smuggle secrets.
      SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO before_value
      FROM jsonb_each(CASE WHEN jsonb_typeof(before_value) = 'object' THEN before_value ELSE '{}'::jsonb END)
      WHERE key = ANY(ARRAY['canManageUsers','canManageProjects','canManageBilling','canViewAnalytics','canInviteUsers']) AND jsonb_typeof(value) = 'boolean';
      SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO after_value
      FROM jsonb_each(CASE WHEN jsonb_typeof(after_value) = 'object' THEN after_value ELSE '{}'::jsonb END)
      WHERE key = ANY(ARRAY['canManageUsers','canManageProjects','canManageBilling','canViewAnalytics','canInviteUsers']) AND jsonb_typeof(value) = 'boolean';
    END IF;
    IF before_value IS DISTINCT FROM after_value THEN
      differences := differences || jsonb_build_object(field, jsonb_build_object('before', before_value, 'after', after_value));
    END IF;
  END LOOP;
  IF differences = '{}'::jsonb THEN RETURN NULL; END IF;
  IF context <> '{}'::jsonb THEN
    IF context->>'organizationId' IS DISTINCT FROM source->>'organization_id'
       OR context->>'actorKind' IS NULL OR context->>'actorKind' NOT IN ('human','system')
       OR coalesce(context->>'actorId','') = '' OR coalesce(context->>'operationId','') = '' THEN
      RAISE EXCEPTION 'Invalid business audit context';
    END IF;
    kind := context->>'actorKind'; actor := context->>'actorId'; operation := context->>'operationId';
  END IF;
  INSERT INTO public.business_audit_events(id, organization_id, actor_kind, actor_id,
    action, resource_type, resource_id, project_id, operation_id, changes, occurred_at)
  VALUES(gen_random_uuid()::text, source->>'organization_id', kind, actor,
    resource || '.' || lower(TG_OP), resource, source->>'id', project, operation, differences, clock_timestamp());
  RETURN NULL;
END $$;

CREATE TRIGGER projects_business_audit AFTER UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.flowlio_business_audit();
CREATE TRIGGER delivery_reviews_business_audit AFTER INSERT OR UPDATE ON public.delivery_reviews
FOR EACH ROW EXECUTE FUNCTION public.flowlio_business_audit();
CREATE TRIGGER user_organizations_business_audit AFTER INSERT OR UPDATE OR DELETE ON public.user_organizations
FOR EACH ROW EXECUTE FUNCTION public.flowlio_business_audit();
CREATE TRIGGER user_management_business_audit AFTER UPDATE ON public.user_management
FOR EACH ROW EXECUTE FUNCTION public.flowlio_business_audit();

CREATE FUNCTION public.flowlio_protect_business_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Business audit events are append-only'; END $$;
CREATE TRIGGER business_audit_immutable BEFORE UPDATE OR DELETE ON public.business_audit_events
FOR EACH ROW EXECUTE FUNCTION public.flowlio_protect_business_audit();

