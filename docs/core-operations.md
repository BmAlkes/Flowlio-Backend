# Core operations and recovery

## Authorization boundaries

An authenticated request resolves current user/session and active organization membership. Never authorize using an organization ID supplied in a request body. Resource visibility is an additional check after organization/role authorization; platform roles are not a general bypass to another tenant's private project.

| Actor | Core behavior |
| --- | --- |
| Organization owner (`user` + owner flag) | Organization administration, billing and internal project finances; project/task visibility still applies |
| Organization manager (`user` + manager flag) | Operational administration, clients/proposals and workflow/capacity screens; no internal project costs and no owner-only user administration |
| Member/operator/viewer | Existing role policy and accessible/assigned resources; do not infer owner privileges from staff navigation |
| Client | Its own client portal records; only shared tasks/files and delivery decisions associated with the current project client |
| Platform admin | Platform routes according to platform role; tenant resources still require their documented context and policy |

Google Calendar integration is separate from email/password authentication. A successful password check is not a completed 2FA challenge. Access revocation must be honored by subsequent API and socket requests.

## Core state and audit trail

| Flow | Persistent records | Invariant |
| --- | --- | --- |
| Proposal to project | `proposal_project_conversions`, projects/tasks/milestones | Approved source version, reviewed draft, one conversion; deleted project leaves a tombstone |
| Time to invoice | `invoice_time_items`, `time_invoicing_requests`, invoice counters | Server pricing and organization numbering; a time entry cannot be billed twice |
| Profitability | `project_financial_settings`, revenue, expenses, time | Explicit currency, one estimated cost assumption, incomplete totals are disclosed |
| Delivery approval | `delivery_reviews` | Exact milestone snapshot, current client identity, immutable decision and stale-version rejection |
| Capacity | `member_capacity`, open tasks/dependencies | Unknown availability/estimates are not free time; planned effort distributed over calendar days |
| Workflow notifications | `workflow_rules`, `workflow_executions`, notifications | Paused by default, new persisted events only, one receipt/effect per rule/event |
| Core onboarding | `onboarding_progress` | Organization/user/role scope; saved facts, not a browser click, establish progress |

The delivery workflow approves a milestone version, not a binary file version. Profitability is an estimate rather than an accounting statement, and does not convert currencies. Weekly capacity is a recurring reference rather than a leave/holiday calendar. Workflow notifications are internal messages to the rule author, not email or an unrestricted automation builder.

## Billing and provider uncertainty

Invoice issuance, revenue entry and payment-provider confirmation are different records. Do not mark an invoice paid solely because a frontend redirect succeeded. Tracked-time invoice prices are persisted in cents, and billing links protect already-invoiced time from edits/deletion while the invoice exists.

For interrupted external work, inspect both provider and application records before retrying. A timeout does not prove the provider rejected the request. Durable jobs marked `uncertain` require reconciliation; never bulk-requeue them. T11 subscription reconciliation remains deferred and no successful real Sandbox activation/webhook/cancellation is claimed by T18-T24 validation.

## Deploy sequence

1. Run lint, build and integration coverage with isolated test databases; push a task branch.
2. Wait for the exact branch commit's required `backend-quality` check. Main protection remains enabled.
3. Integrate into main; Railway runs the existing build/start configuration. Both HTTP and worker wait for pending release migrations.
4. Confirm provider success and `GET /api/health`; inspect a new failure's reference/version if available. `RAILWAY_GIT_COMMIT_SHA` identifies the release in operational telemetry, with `APP_VERSION` as fallback.
5. Publish compatible frontend code only after the backend is available. Verify the actual `flowlioapp.com` bundle, not just a Cloudflare preview.

Keep `module-alias/register` before route imports in the compiled HTTP entry. The compiled-startup test runs without `ts-node`/`tsconfig-paths`, applies an empty database and checks the protected API. The `throttle` table is adopted/created by migration `0010_request_throttle`; `RateLimiterPostgres` uses `tableCreated: true` and must not race to create it at import time.

## Diagnose without exposing private payloads

Organization owners/managers: `/dashboard/settings/operations`; platform superadmin: `/superadmin/operations`. Record route, UTC time, reference ID and release. Read state without copying payloads or credentials:

```sql
SELECT position, name, applied_at FROM flowlio_releases.migrations ORDER BY position;
SELECT kind, status, count(*) FROM durable_jobs GROUP BY kind, status ORDER BY kind, status;
SELECT kind, enabled, next_run_at FROM job_schedules ORDER BY kind;
SELECT outcome, count(*) FROM workflow_executions GROUP BY outcome;
SELECT role, count(*) AS started, count(completed_at) AS activated
FROM onboarding_progress GROUP BY role;
```

The final onboarding query is an operator/platform aggregate. Any organization-facing version must add an explicit organization predicate. Activation timestamps are first observations by onboarding, not reconstructed historical creation dates. Legacy `user_onboarding` remains preserved but its manual checks are not trusted as new evidence.

## Recovery

- Migration failed: inspect the first SQL error. The migration transaction rolls back and the server does not listen. Restore the published migration files if hashes differ; add a corrective migration for genuine schema incompatibility. Do not edit ledger hashes or remove guards/counters.
- UI deployment mismatch: compare frontend and backend commits. Roll back code only when it remains compatible with applied schema and queue state. Prefer a forward fix after migrations have been applied.
- Database recovery: preserve a provider snapshot/export before destructive operations, restore to an isolated database, run migration checks and validate row counts/tenant relationships, then plan the production cutover. A production restore was not exercised in T24.
- Jobs: follow [durable job recovery](durable-jobs.md). Database effects can retry transactionally; uncertain external effects require provider verification. Do not run a second development worker against production.
- Failed GitHub notification: inspect the run's actual failed test/job. Deliberate SQL failures in rollback tests are expected. A failed feature-branch check blocks release; it is not itself a production outage.
