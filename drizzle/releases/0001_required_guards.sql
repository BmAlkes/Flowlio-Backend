-- Source: 0034_invoice_number_sequences.sql
-- Additive migration. Existing invoices are never renumbered.
-- The transaction and write lock make backfill + trigger installation atomic.
SELECT pg_advisory_xact_lock(6034001);
CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  series text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (organization_id, series)
);
LOCK TABLE public.invoices IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.invoice_number_counters (organization_id, series, last_value)
SELECT organization_id, split_part(invoice_number, '-', 1),
       max(split_part(invoice_number, '-', 2)::bigint)
FROM public.invoices WHERE invoice_number ~ '^(S1|REC)-[0-9]+$'
GROUP BY organization_id, split_part(invoice_number, '-', 1)
ON CONFLICT (organization_id, series) DO UPDATE
SET last_value = greatest(invoice_number_counters.last_value, EXCLUDED.last_value);

-- Recover previously issued numbers from retained create/delete activity records.
DO $$
BEGIN
  IF to_regclass('public.recent_activities') IS NOT NULL THEN
    INSERT INTO public.invoice_number_counters (organization_id, series, last_value)
    SELECT organization_id, parts[1], max(parts[2]::bigint)
    FROM (
      SELECT a.organization_id,
        regexp_match(a.message, '^(?:Created|Deleted) invoice: (S1|REC)-([0-9]+)(?: |$)') AS parts
      FROM public.recent_activities a JOIN public.organizations o ON o.id = a.organization_id
      WHERE a.type = 'invoice' AND a.resource = 'invoice' AND a.action IN ('create', 'delete')
    ) history WHERE parts IS NOT NULL
    GROUP BY organization_id, parts[1]
    ON CONFLICT (organization_id, series) DO UPDATE
    SET last_value = greatest(invoice_number_counters.last_value, EXCLUDED.last_value);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_invoice_number() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE invoice_series text; allocated bigint; digits text;
BEGIN
  -- Also accept legacy count-based inserts during rolling deploys and rollback.
  IF NEW.invoice_number !~ '^(S1|REC)-[0-9]*$' THEN RETURN NEW; END IF;
  invoice_series := split_part(NEW.invoice_number, '-', 1);
  INSERT INTO public.invoice_number_counters (organization_id, series, last_value)
  VALUES (NEW.organization_id, invoice_series, 1)
  ON CONFLICT (organization_id, series) DO UPDATE
  SET last_value = invoice_number_counters.last_value + 1
  RETURNING last_value INTO allocated;
  digits := allocated::text;
  NEW.invoice_number := invoice_series || '-' || lpad(digits, greatest(5, length(digits)), '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invoices_assign_number ON public.invoices;
CREATE TRIGGER invoices_assign_number BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.assign_invoice_number();

--> statement-breakpoint
-- Source: 0035_time_invoicing.sql
SELECT pg_advisory_xact_lock(6035001);
CREATE TABLE IF NOT EXISTS public.invoice_time_items (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  time_entry_id text NOT NULL UNIQUE REFERENCES public.time_entries(id) ON DELETE RESTRICT,
  user_name text NOT NULL,
  project_name text NOT NULL,
  task_title text,
  description text,
  started_at timestamp NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  hourly_rate numeric(10,2) NOT NULL CHECK (hourly_rate > 0),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS invoice_time_items_invoice_idx ON public.invoice_time_items(invoice_id);
CREATE TABLE IF NOT EXISTS public.time_invoicing_requests (
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  actor_id text NOT NULL,
  request_hash text NOT NULL,
  invoice_id text REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, request_key)
);
-- Preserve the billing basis while an invoice exists. Tags/notes may still change.
CREATE OR REPLACE FUNCTION public.protect_invoiced_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(OLD.user_id, OLD.project_id, OLD.task_id, OLD.client_id, OLD.start_time, OLD.end_time,
         OLD.duration, OLD.billable, OLD.hourly_rate, OLD.status)
     IS DISTINCT FROM
     ROW(NEW.user_id, NEW.project_id, NEW.task_id, NEW.client_id, NEW.start_time, NEW.end_time,
         NEW.duration, NEW.billable, NEW.hourly_rate, NEW.status)
     AND EXISTS (SELECT 1 FROM public.invoice_time_items WHERE time_entry_id = OLD.id) THEN
    RAISE EXCEPTION 'Invoiced time cannot be changed while its invoice exists' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_entries_protect_billing ON public.time_entries;
CREATE TRIGGER time_entries_protect_billing BEFORE UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_invoiced_time();

--> statement-breakpoint
-- Source: 0036_time_tracking_guard.sql
SELECT pg_advisory_xact_lock(6036001);
-- Keep existing active records intact; block new overlaps, including old writers.
CREATE INDEX IF NOT EXISTS time_entries_active_user_idx ON public.time_entries(user_id) WHERE status = 'active';
CREATE OR REPLACE FUNCTION public.guard_active_timer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active' OR OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('time-tracking:' || NEW.user_id, 0));
    IF EXISTS (SELECT 1 FROM public.time_entries WHERE user_id = NEW.user_id AND status = 'active' AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Stop your active timer before starting another' USING ERRCODE = '23505', CONSTRAINT = 'time_entries_one_active_timer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_entries_guard_active ON public.time_entries;
CREATE TRIGGER time_entries_guard_active BEFORE INSERT OR UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.guard_active_timer();
