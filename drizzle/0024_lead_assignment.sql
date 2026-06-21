-- Lead assignment: assign leads to team members
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_to text REFERENCES users(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS followup_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS clients_assigned_to_idx ON clients(assigned_to, organization_id);
