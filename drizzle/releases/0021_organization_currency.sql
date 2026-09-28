ALTER TABLE clients ADD COLUMN currency_code text;
ALTER TABLE recurring_invoices ADD COLUMN currency_code text;
ALTER TABLE payment_links ADD COLUMN currency_code text;
ALTER TABLE revenue_entries ALTER COLUMN currency DROP DEFAULT;
-- Unknown historical denominations stay unknown. Selecting a new organization
-- currency never relabels old documents or amounts.
CREATE FUNCTION organization_record_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.currency_code IS NULL THEN
  SELECT settings->>'currency' INTO NEW.currency_code FROM organizations WHERE id=NEW.organization_id;
  IF NOT valid_financial_currency(NEW.currency_code) THEN NEW.currency_code:=NULL; END IF;
 END IF;
 IF NEW.currency_code IS NOT NULL AND NOT valid_financial_currency(NEW.currency_code) THEN RAISE EXCEPTION 'Invalid currency'; END IF;
 IF TG_OP='UPDATE' AND OLD.currency_code IS NOT NULL AND NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN RAISE EXCEPTION 'Recorded currency requires reconciliation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clients_currency_guard BEFORE INSERT OR UPDATE OF currency_code ON clients FOR EACH ROW EXECUTE FUNCTION organization_record_currency();
CREATE TRIGGER recurring_currency_guard BEFORE INSERT OR UPDATE OF currency_code ON recurring_invoices FOR EACH ROW EXECUTE FUNCTION organization_record_currency();
CREATE TRIGGER payment_links_currency_guard BEFORE INSERT OR UPDATE OF currency_code ON payment_links FOR EACH ROW EXECUTE FUNCTION organization_record_currency();
