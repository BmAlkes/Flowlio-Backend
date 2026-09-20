# Subscription reconciliation (T11)

Verified PayPal events are inserted into `subscription_events` and `durable_jobs` in one transaction. The event ID is the deduplication key. HTTP 200 means durable receipt; invalid signatures return 401, while verification/storage outages return 503 so PayPal can retry. No payer details or complete webhook bodies are retained.

`subscription-reconcile` locks the local subscription before fetching the current PayPal snapshot. Subscription and organization state, the inbox marker and job completion commit together. Events delivered out of order therefore do not dictate state. Recoverable jobs follow the T10 retry policy. An hourly `subscription-renewal` sweep includes past-due subscriptions and missed periods, providing recovery after exhausted event retries. Provider calls have timeouts.

`subscriptions.paypal_subscription_id` is unique and indexed. The release migration backfills the legacy JSON value and preserves existing cancellation requests. Duplicate legacy agreements abort the migration transaction; investigate ownership before retrying, without deleting records to force deployment.

## Billing rules

- Payment notifications use `PAYMENT.SALE.COMPLETED` and its `billing_agreement_id`; a one-off sale cannot be mistaken for a subscription.
- Renewal adopts PayPal billing dates. A scheduled next charge alone, failed payments, outstanding balances or reuse of a previously recorded payment do not grant another paid period.
- Cancellation is restricted to the organization owner. The API first persists intent and a recovery job, then requests cancellation at PayPal. A failure is not reported as success. Retrying first reads provider state, so a crash after cancellation does not repeat the action. Paid access is retained until the existing end date.
- Suspended subscriptions become `past_due`; expired subscriptions become `expired`. An active provider agreement can recover a past-due local record after payment.
- Free plans use UTC calendar arithmetic anchored at the original period start, including month-end and leap-year clamping. Paid legacy orders without recurring agreements are not automatically extended without payment.
- Creation binds new PayPal agreements to the authenticated user with `custom_id`. Activation verifies the selected PayPal plan and payment, then commits organization, subscription, user and initial AI quota atomically. Replayed activation returns the original local subscription. An old unlinked agreement without `custom_id` requires support review; it must not be reassigned based only on a supplied ID.
- Checkout retains an approved agreement in account-scoped session storage until confirmation succeeds. Its retry button confirms the same agreement and original plan.

## Operational review

Inspect `subscription_events` with `processed_at IS NULL` and `durable_jobs` where `kind='subscription-reconcile'` and `status IN ('failed','retry')`. Job payload identifies the provider agreement and, for event jobs, the event ID. A successful later sweep marks pending events for that agreement reconciled. Unlinked agreements require completing checkout or support review. Refund/reversal notifications trigger a fresh snapshot; this phase does not invent a refund entitlement policy or issue refunds.

After correcting configuration, a sweep can be queued through the existing `AutoRenewalService.forceRenewalCheck()` operation. It now enqueues work rather than performing synchronous untracked renewal. Do not replay external payment capture operations as a substitute for reconciliation.

## Validation

Local tests use a dedicated PostgreSQL instance at localhost:55441/flowlio_subscription_test and simulated provider responses. Set `SUBSCRIPTION_TEST_DATABASE_URL` to run the integration suite. Tests reject other database addresses. They cover concurrent event delivery, rollback, provider outage/retry, out-of-order events, a crash after cancellation, calendar boundaries, tenant ownership, atomic activation, migration adoption and duplicate identifiers.

Real PayPal sandbox validation is still required before completing the release: configure sandbox credentials and a webhook ID for the test backend; approve a test agreement; confirm activation; resend its event; cancel; verify provider status and remaining paid access. No production credentials or real charges are used by local tests. The PayPal webhook simulator alone is not equivalent to signature-verified sandbox delivery.

References: [subscription event names](https://developer.paypal.com/subscriptions/webhooks/), [webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/), [subscriptions API](https://developer.paypal.com/api/subscriptions/v1).
