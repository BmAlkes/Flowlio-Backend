-- Revenue entries table for manual + invoice-synced revenue tracking
CREATE TABLE IF NOT EXISTS revenue_entries (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date            date NOT NULL,
  amount          numeric(12,2) NOT NULL,
  currency        varchar(3) NOT NULL DEFAULT 'USD',
  category        varchar(50) NOT NULL DEFAULT 'service',
  source          varchar(30) NOT NULL DEFAULT 'manual',
  description     text,
  client_id       text REFERENCES clients(id) ON DELETE SET NULL,
  project_id      text REFERENCES projects(id) ON DELETE SET NULL,
  invoice_id      text UNIQUE REFERENCES invoices(id) ON DELETE SET NULL,
  created_by      text NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_entries_org_idx   ON revenue_entries(organization_id, date DESC);
CREATE INDEX IF NOT EXISTS revenue_entries_client_idx ON revenue_entries(client_id);
CREATE INDEX IF NOT EXISTS revenue_entries_source_idx ON revenue_entries(source);

-- One-time sync: create revenue_entries for all existing paid invoices
INSERT INTO revenue_entries (id, organization_id, date, amount, currency, category, source, description, client_id, invoice_id, created_by, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  i.organization_id,
  COALESCE(i.date_paid::date, i.created_at::date),
  CAST(i.amount AS numeric(12,2)),
  'USD',
  'service',
  'invoice',
  i.invoice_number,
  i.client_id,
  i.id,
  i.created_by,
  now(),
  now()
FROM invoices i
WHERE LOWER(i.status) = 'paid'
  AND i.amount IS NOT NULL
  AND CAST(i.amount AS numeric) > 0
ON CONFLICT (invoice_id) DO NOTHING;
