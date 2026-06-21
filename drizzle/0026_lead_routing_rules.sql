-- Auto-routing rules for incoming leads
CREATE TABLE IF NOT EXISTS lead_routing_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL,
  actions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_routing_rules_org_idx ON lead_routing_rules(organization_id, priority);
