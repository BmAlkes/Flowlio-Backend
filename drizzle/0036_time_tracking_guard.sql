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
