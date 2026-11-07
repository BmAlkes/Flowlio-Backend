-- Additive: per-user Google Calendar incremental sync token and push-notification channel.
CREATE TABLE IF NOT EXISTS "google_calendar_sync_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sync_token" text,
	"channel_id" text,
	"channel_resource_id" text,
	"channel_token" text,
	"channel_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_sync_state_channel_id_unique" UNIQUE("channel_id"),
	CONSTRAINT "google_calendar_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
