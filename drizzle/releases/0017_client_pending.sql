CREATE TABLE client_requests (
 id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, client_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('briefing','question','file')), title text NOT NULL, description text NOT NULL,
 questions jsonb NOT NULL DEFAULT '[]', dependencies text[] NOT NULL DEFAULT '{}',
 assigned_to text REFERENCES users(id) ON DELETE SET NULL, created_by text NOT NULL, request_hash text NOT NULL,
 due_date text, timezone text NOT NULL, due_at timestamptz,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','answered','completed','cancelled')),
 revision integer NOT NULL DEFAULT 0, cycle integer NOT NULL DEFAULT 1,
 reminder_hours integer NOT NULL DEFAULT 0 CHECK(reminder_hours IN (0,24,48,72,168)),
 reminder_channel text NOT NULL DEFAULT 'internal' CHECK(reminder_channel IN ('internal','email','push')),
 reminder_next_at timestamptz, reminder_count integer NOT NULL DEFAULT 0 CHECK(reminder_count BETWEEN 0 AND 3),
 reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX client_requests_project_idx ON client_requests(organization_id,project_id,created_at,id);
CREATE INDEX client_requests_reminder_idx ON client_requests(reminder_next_at) WHERE state='open' AND reminder_hours>0;
CREATE TABLE client_request_responses (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
 cycle integer NOT NULL, actor_id text NOT NULL, message text NOT NULL, answers jsonb NOT NULL, attachments jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT client_request_response_cycle_key UNIQUE(request_id,cycle)
);
CREATE TABLE client_request_commands (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
 actor_id text NOT NULL, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_request_reminders (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
 cycle integer NOT NULL, sequence integer NOT NULL, job_id text, outcome text NOT NULL DEFAULT 'queued',
 created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT client_request_reminder_key UNIQUE(request_id,cycle,sequence)
);
CREATE TABLE client_request_events (
 id text PRIMARY KEY, request_id text NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
 action text NOT NULL, actor_id text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_request_events_request_idx ON client_request_events(request_id,created_at,id);
