CREATE FUNCTION valid_financial_currency(value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(value = ANY(ARRAY['AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XDR','XOF','XPF','XSU','YER','ZAR','ZMW','ZWG','ZWL']::text[]),false) $$;
ALTER TABLE projects ADD COLUMN currency_code text;
ALTER TABLE invoices ADD COLUMN currency_code text;
ALTER TABLE invoice_time_items ADD COLUMN currency_code text;

-- Recover only recorded currencies. Never relabel legacy invoices as USD.
UPDATE projects p SET currency_code=f.currency FROM project_financial_settings f WHERE f.project_id=p.id;
UPDATE projects p SET currency_code=coalesce(
  nullif(s.proposal_data->>'currencyCode',''),
  nullif(s.proposal_data->'investment'->>'currencyCode',''),
  nullif(s.proposal_data->'investment'->>'currency',''),
  (SELECT CASE WHEN count(DISTINCT code)=1 THEN min(code) END FROM (SELECT m[1] AS code FROM regexp_matches(s.proposal_data->'investment'->>'totalBudget', '\m([A-Z]{3})\M', 'g') m WHERE valid_financial_currency(m[1]) UNION ALL SELECT 'ILS' WHERE s.proposal_data->'investment'->>'totalBudget' LIKE '%₪%' UNION ALL SELECT 'EUR' WHERE s.proposal_data->'investment'->>'totalBudget' LIKE '%€%') currencies))
FROM proposal_project_conversions c JOIN proposals s ON s.id=c.proposal_id
WHERE c.project_id=p.id AND p.currency_code IS NULL;
UPDATE projects SET currency_code=NULL WHERE NOT valid_financial_currency(currency_code);
UPDATE projects p SET currency_code=o.settings->>'currency' FROM organizations o
WHERE o.id=p.organization_id AND p.currency_code IS NULL AND valid_financial_currency(o.settings->>'currency');

CREATE FUNCTION project_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.currency_code IS NULL THEN
  SELECT settings->>'currency' INTO NEW.currency_code FROM organizations WHERE id=NEW.organization_id;
  IF NOT valid_financial_currency(NEW.currency_code) THEN NEW.currency_code:=NULL; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.currency_code IS NOT NULL AND NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
  RAISE EXCEPTION 'Project currency is recorded; changing its denomination requires reconciliation';
 END IF;
 IF NEW.currency_code IS NOT NULL AND NOT valid_financial_currency(NEW.currency_code) THEN RAISE EXCEPTION 'Invalid currency'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER projects_currency_guard BEFORE INSERT OR UPDATE OF currency_code ON projects FOR EACH ROW EXECUTE FUNCTION project_currency_guard();

CREATE FUNCTION financial_settings_currency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE projects SET currency_code=NEW.currency WHERE id=NEW.project_id;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_settings_currency_guard BEFORE INSERT OR UPDATE OF currency ON project_financial_settings FOR EACH ROW EXECUTE FUNCTION financial_settings_currency_guard();
