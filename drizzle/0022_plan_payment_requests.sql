-- On-demand plan payment flow: tracks PayPal one-time orders created by superadmin
CREATE TABLE IF NOT EXISTS plan_payment_requests (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id         text NOT NULL REFERENCES subscription_plans(id),
  paypal_order_id text NOT NULL UNIQUE,
  amount          numeric(10,2) NOT NULL,
  currency        text NOT NULL DEFAULT 'USD',
  start_date      timestamptz NOT NULL,
  end_date        timestamptz NOT NULL,
  description     text,
  notes           text,
  invoice_number  text,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_payment_requests_org_idx    ON plan_payment_requests(org_id);
CREATE INDEX IF NOT EXISTS plan_payment_requests_status_idx ON plan_payment_requests(status);
CREATE INDEX IF NOT EXISTS plan_payment_requests_order_idx  ON plan_payment_requests(paypal_order_id);
