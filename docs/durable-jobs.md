# Durable jobs (T10)

`npm start` supervises two separate Node processes: HTTP and the durable worker. If either exits unexpectedly, the supervisor stops its sibling and exits nonzero so Railway can restart the deployment. Shutdown allows 25 seconds for work to finish; interrupted database jobs roll back and remain recoverable. Both processes wait for release migrations before serving or claiming work.

For separate services use `npm run start:http` and `npm run start:worker`, with the same database and backend configuration. Development uses `npm run dev` plus `npm run dev:worker`. Do not start another worker on a production database merely to test it: workers execute real due jobs.

## Scheduling and execution

- `job_schedules` persists the next UTC occurrence. New installations start from the next scheduled time; established cursors catch up after downtime, in batches of at most 100 occurrences per schedule per poll. Per-organization reminder hours still use the scheduled occurrence, not the worker's current hour. Weekly summary occurrences older than seven days complete without regenerating today's summary repeatedly.
- `durable_jobs` deduplicates occurrences, records attempts/status and stores pending payloads. One PostgreSQL session advisory lock per handler kind prevents overlapping executions across workers. Different kinds can run on other workers even when one kind has a backlog. A broken lock connection stops the worker; its session lock is released by PostgreSQL. Jobs exceeding ten minutes stop the worker for recovery.
- Database jobs commit effects and completion together. Transient failures retry after 30, 60, 120 and 240 seconds, with a maximum of five attempts. A crashed worker's `running` job can be claimed by another worker once its session lock is gone. Nested invoice transactions use savepoints, so killing the worker cannot commit an invoice without completing the job.
- Reminder notifications and their markers commit together. Automation emails and pushes are queued in that same transaction and delivered afterwards. Scheduled email counts in automation history increase only when delivery is confirmed. Automation batches are isolated by organization.
- Webhook retries lock each log and commit lead creation with its success state. Invalid retries back off and eventually become `permanently_failed`. Manual retry checks the requesting organization and cannot reopen successful/merged logs.
- Calendar sync controls persist enabled state and interval (1–1440 minutes). Force sync queues the authenticated user's request and returns HTTP 202. Disabling a schedule prevents new scheduled syncs; an in-progress operation may finish. `ENABLE_BACKGROUND_SYNC=false` sets the initial disabled state; persisted administrator controls subsequently take precedence.

## External effects and recovery

External email, push, calendar and renewal operations cannot commit atomically with PostgreSQL. A failed or interrupted external job is marked `uncertain` instead of automatically repeating a possibly completed operation. Weekly AI summaries follow the same no-automatic-replay policy because an interrupted generation can already have consumed credits. Pending jobs that have not begun still execute normally. Subscription reconciliation remains T11.

The previous notification/renewal/calendar business rules remain in their services. Provider sandbox transactions were not performed for T10. Push endpoints reported expired by the provider are removed as before.

Inspect operational state without exposing payloads:

```sql
SELECT kind, status, count(*) FROM durable_jobs GROUP BY kind, status ORDER BY kind, status;
SELECT id, kind, attempts, last_error, started_at, finished_at
FROM durable_jobs WHERE status IN ('failed', 'uncertain') ORDER BY scheduled_at;
SELECT kind, enabled, next_run_at, interval_minutes FROM job_schedules ORDER BY kind;
```

After correcting a database-job failure, an operator can reset that specific `failed` job to `retry`, set attempts to zero and available_at to now(). Never reset a running job. For `uncertain` external effects, first reconcile provider/application records; mark completed if the effect happened, or requeue only after confirming it did not. Do not bulk-reset uncertain deliveries. Completed payloads are cleared automatically; dedupe keys and status are retained. Failed/uncertain payloads are retained for diagnosis; restrict database access accordingly. Completed history may be archived after 30 days, preserving schedule cursors and all unfinished jobs.

For a code rollback to pre-T10, stop the T10 worker before starting the old scheduler, and preserve the queue/migration tables. Running old timers and the new worker together is not a supported steady state.

## Validation

`JOBS_TEST_DATABASE_URL` must point to the disposable local database `flowlio_jobs_test` on port 55440. The integration suite resets its fixtures, runs concurrent schedulers/workers, kills real worker processes during invoice/notification/webhook transactions, verifies recovery and retry exhaustion, and checks paused schedules and manual webhook tenant isolation. External providers are substituted with stubs. Release migration tests use a separate disposable database on port 55439 as documented in release-migrations.md.

In the application, inspect recurring invoices under `/dashboard/invoice`, due reminders in `/dashboard/inbox`, and webhook retry status under `/dashboard/leads/webhooks`. There is no new queue administration screen in T10.
