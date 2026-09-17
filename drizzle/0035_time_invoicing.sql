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
