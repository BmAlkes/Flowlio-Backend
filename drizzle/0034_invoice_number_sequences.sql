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
