# Incremental domain modules (T13)

HTTP controllers keep request validation, status codes and response messages. The extracted use cases own the operation and receive explicit inputs, without Express request/response objects.

- `src/modules/projects/read-projects.ts`: list and find projects. Query projections, joins, ordering, read policy and financial redaction are retained from the original controllers. Organization validation still occurs in the HTTP adapter. Client-specific and viewer-specific queries are unchanged.
- `src/modules/payments/update-payment-link-status.ts`: update an existing payment link using both organization and link ID in a single write predicate. This is a manual status update, not provider capture, checkout or subscription reconciliation.
- `src/modules/automations/run-manual-automation.ts`: invoke the selected handler once, then await the existing history writer. The shared HTTP adapter preserves organization requirements, superadmin behavior, response text and failure handling. Individual definitions keep their original handler options; weekly summary and webhook issue do not gain forceRun. The durable worker is unchanged.

Frontend login orchestration lives under `src/features/auth`: successful authentication and provider-error handling are separate from form rendering. Legacy error compatibility is retained, including existing fallback behavior. This extraction is not a new authentication policy.

## Regression checks

`npm test` includes domain module tests with a simulated query builder and automation providers. Tests assert both identifiers in payment write predicates, project read policy/budget handling, all eleven automation definitions, execution/history ordering, and failure without retry. Existing route authorization and contract tests remain in place. Frontend tests cover second-factor redirect, refresh before navigation, pending-payment paths, demo exemption, suspended organization and wrapped provider errors.

No database migration or new environment variable. Build/deploy as usual. T11 remains on its separate branch. Revert the T13 application commits if rollback is needed; no data conversion is involved.
