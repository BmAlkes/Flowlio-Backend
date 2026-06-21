-- Lead tags and tag assignments
CREATE TABLE IF NOT EXISTS lead_tags (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(50) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#6B7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS lead_tag_assignments (
  lead_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag_id text NOT NULL REFERENCES lead_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS lead_tags_org_idx ON lead_tags(organization_id);
CREATE INDEX IF NOT EXISTS lead_tag_assignments_tag_idx ON lead_tag_assignments(tag_id);
