CREATE TABLE capacity_absences (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, start_date text NOT NULL, end_date text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('vacation','unavailable')), revision integer NOT NULL DEFAULT 0,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT capacity_absence_dates CHECK(start_date <= end_date)
);
CREATE INDEX capacity_absences_org_user_idx ON capacity_absences(organization_id,user_id,start_date,end_date);
CREATE TABLE capacity_scenarios (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL,
 week_start text NOT NULL, weeks integer NOT NULL CHECK(weeks BETWEEN 1 AND 12),
 base jsonb NOT NULL, base_hash text NOT NULL, changes jsonb NOT NULL DEFAULT '[]',
 revision integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','applied')),
 creation_hash text NOT NULL, apply_key text, apply_hash text, applied_ids jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz
);
CREATE INDEX capacity_scenarios_author_idx ON capacity_scenarios(organization_id,created_by,created_at);
