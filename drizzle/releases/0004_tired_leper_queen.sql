CREATE TABLE "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"paypal_subscription_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "paypal_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_paypal_subscription_id_unique" UNIQUE("paypal_subscription_id");
--> statement-breakpoint
-- A duplicate legacy identifier must be investigated, never assigned arbitrarily.
UPDATE subscriptions SET paypal_subscription_id = NULLIF(metadata->>'paypalSubscriptionId', '')
WHERE paypal_subscription_id IS NULL AND NULLIF(metadata->>'paypalSubscriptionId', '') IS NOT NULL;

--> statement-breakpoint
-- Honor cancellation requests already accepted by the old application.
UPDATE subscriptions SET metadata=COALESCE(metadata::jsonb,'{}'::jsonb) ||
  jsonb_build_object('cancellationRequestedAt',COALESCE(cancelled_at,updated_at)::text)
WHERE paypal_subscription_id IS NOT NULL AND cancel_at_period_end=true
  AND metadata->>'cancellationRequestedAt' IS NULL;
