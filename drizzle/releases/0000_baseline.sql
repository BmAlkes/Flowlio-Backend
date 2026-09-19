-- T09 additive baseline: supports empty databases and adoption of existing installations.
-- Existing columns, data, defaults and extra legacy objects are preserved.
-- Missing required fields or incompatible data fail the transaction; no invented backfill.
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"two_factor_enabled" boolean NOT NULL,
	"image" text,
	"phone" text,
	"address" text,
	"billing_email" text,
	"role" text,
	"status" text,
	"is_organization_owner" boolean,
	"is_organization_manager" boolean,
	"is_super_admin" boolean NOT NULL,
	"subadmin_id" text,
	"selected_plan_id" text,
	"pending_organization_data" json,
	"timezone" text NOT NULL,
	"notification_preferences" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"position" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factor_backup_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"two_factor_id" text NOT NULL,
	"code" text NOT NULL,
	"used" boolean NOT NULL,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"custom_plan_name" text,
	"price" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"duration_value" integer,
	"duration_type" text,
	"trial_days" integer,
	"features" json,
	"paypal_plan_id" text,
	"paypal_product_id" text,
	"is_active" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "subscription_plans_slug_unique" UNIQUE("slug")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"logo" text,
	"logo_public_id" text,
	"website" text,
	"industry" text,
	"size" text,
	"country" text,
	"status" text,
	"subscription_plan_id" text,
	"subscription_status" text,
	"subscription_start_date" timestamp,
	"subscription_end_date" timestamp,
	"trial_ends_at" timestamp,
	"max_users" integer,
	"max_projects" integer,
	"max_storage" integer,
	"override_max_leads" integer,
	"override_max_clients" integer,
	"override_max_webhooks" integer,
	"override_max_tasks" integer,
	"override_max_invoices" integer,
	"override_max_proposals" integer,
	"override_ai_token_limit" integer,
	"settings" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"permissions" json,
	"invited_by" text,
	"invited_at" timestamp,
	"joined_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subadmin" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"contact_number" text,
	"permission" text NOT NULL,
	"password" text,
	"logo" text,
	"logo_public_id" text,
	"created_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "subadmin_email_unique" UNIQUE("email")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_number" text NOT NULL,
	"client_id" text,
	"description" text,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"assigned_to" text,
	"status" text,
	"visibility" text DEFAULT 'private',
	"start_date" timestamp,
	"end_date" timestamp,
	"progress" integer,
	"address" text,
	"budget" numeric(10, 2),
	"contractfile" text,
	"contractfile_public_id" text,
	"project_files" json,
	"tags" json,
	"custom_fields" json,
	"settings" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"parent_id" text,
	"task_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" text NOT NULL,
	"assigned_to" text,
	"created_by" text NOT NULL,
	"status" text,
	"visibility" text DEFAULT 'private',
	"end_date" timestamp,
	"start_after" text,
	"finish_before" text,
	"start_date" timestamp,
	"estimated_hours" numeric(10, 2),
	"actual_hours" numeric(10, 2),
	"attachments" json,
	"parent_id" text,
	"overdue_notified_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancel_at_period_end" boolean,
	"cancelled_at" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"metadata" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_number_counters" (
	"organization_id" text NOT NULL,
	"series" text NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY("organization_id","series"),
	CONSTRAINT "invoice_number_counters_last_value_check" CHECK ("invoice_number_counters"."last_value" >= 0)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_by" text NOT NULL,
	"invoice_number" text NOT NULL,
	"client_name" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"date_paid" timestamp,
	"due_date" timestamp,
	"description" text,
	"pdf_url" text,
	"pdf_file_name" text,
	"pdf_file_size" integer,
	"payment_url" text,
	"overdue_notified_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "unique_invoice_number_per_org" UNIQUE("invoice_number","organization_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"paypal_order_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"description" text,
	"notes" text,
	"invoice_number" text,
	"status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "plan_payment_requests_paypal_order_id_unique" UNIQUE("paypal_order_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenue_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"description" text,
	"client_id" text,
	"project_id" text,
	"invoice_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "revenue_entries_invoice_id_unique" UNIQUE("invoice_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_by" text NOT NULL,
	"template_name" text NOT NULL,
	"client_name" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" text,
	"frequency" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"last_run_date" timestamp,
	"next_run_date" timestamp NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_provider_unique" UNIQUE("user_id","provider_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "throttle_insight" (
	"wait_time" integer NOT NULL,
	"ms_before_next" integer NOT NULL,
	"end_point" varchar(225),
	"allotted_points" integer NOT NULL,
	"consumed_points" integer NOT NULL,
	"remaining_points" integer NOT NULL,
	"key" varchar(225) PRIMARY KEY NOT NULL,
	"is_first_in_duration" boolean NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_management" (
	"id" text PRIMARY KEY NOT NULL,
	"firstname" text NOT NULL,
	"lastname" text NOT NULL,
	"email" text NOT NULL,
	"companyname" text NOT NULL,
	"phonenumber" text NOT NULL,
	"userrole" text NOT NULL,
	"setpermission" text NOT NULL,
	"password" text NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"is_active" boolean NOT NULL,
	"last_login_at" timestamp,
	"login_attempts" integer,
	"locked_until" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"position" text,
	CONSTRAINT "user_management_email_unique" UNIQUE("email")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"date" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"task_id" text,
	"client_id" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"type" text NOT NULL,
	"version_number" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"image" text,
	"image_public_id" text,
	"phone" text,
	"cpf_cnpj_number" text,
	"business_industry" text,
	"address" text,
	"social_media_links" json,
	"custom_fields" json,
	"status" text,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"lead_value" numeric(10, 2),
	"lead_probability" integer DEFAULT 0,
	"last_interaction_at" timestamp,
	"lead_temperature" text,
	"follow_up_at" timestamp,
	"follow_up_note" text,
	"type" text,
	"webhook_id" text,
	"webhook_name" text,
	"assigned_to" text,
	"assigned_at" timestamp,
	"followup_notified_at" timestamp,
	"portal_access_enabled" boolean DEFAULT true NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"client_id" text,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration" integer,
	"billable" boolean,
	"hourly_rate" numeric(10, 2),
	"status" text,
	"tags" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_time_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"user_name" text NOT NULL,
	"project_name" text NOT NULL,
	"task_title" text,
	"description" text,
	"started_at" timestamp NOT NULL,
	"minutes" integer NOT NULL,
	"hourly_rate" numeric(10, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	CONSTRAINT "invoice_time_items_time_entry_id_unique" UNIQUE("time_entry_id"),
	CONSTRAINT "invoice_time_items_minutes_check" CHECK ("invoice_time_items"."minutes" > 0),
	CONSTRAINT "invoice_time_items_hourly_rate_check" CHECK ("invoice_time_items"."hourly_rate" > 0),
	CONSTRAINT "invoice_time_items_amount_check" CHECK ("invoice_time_items"."amount" >= 0)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_invoicing_requests" (
	"organization_id" text NOT NULL,
	"request_key" text NOT NULL,
	"actor_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "time_invoicing_requests_organization_id_request_key_pk" PRIMARY KEY("organization_id","request_key")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" json,
	"read" boolean,
	"read_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"metadata" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interaction_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"interaction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" json,
	"required" boolean,
	"position" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"token" text NOT NULL,
	"active" boolean,
	"field_mapping" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "lead_webhooks_token_unique" UNIQUE("token")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_webhook_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" json,
	"lead_id" text,
	"error" text,
	"ip" text,
	"retry_count" integer DEFAULT 0,
	"next_retry_at" timestamp,
	"max_retries" integer DEFAULT 3,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "lead_tags_org_name_unique" UNIQUE("organization_id","name")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_tag_assignments" (
	"lead_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "lead_tag_assignments_lead_id_tag_id_pk" PRIMARY KEY("lead_id","tag_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_routing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"conditions" json NOT NULL,
	"actions" json NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"old_values" json,
	"new_values" json,
	"ip_address" text,
	"user_agent" text,
	"metadata" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"permissions" json,
	"invited_by" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"status" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_by_role" text NOT NULL,
	"submitted_by_name" text NOT NULL,
	"destination" text DEFAULT 'platform' NOT NULL,
	"client" text NOT NULL,
	"assigned_to" text NOT NULL,
	"created_on" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_ticket_number_unique" UNIQUE("ticket_number")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_role" text NOT NULL,
	"sender_name" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_by" text NOT NULL,
	"description" text NOT NULL,
	"project" text NOT NULL,
	"submitted_by" text NOT NULL,
	"client_name" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"external_payment_url" text,
	"status" text,
	"reminder_notified_at" timestamp,
	"payment_link" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "payment_links_payment_link_unique" UNIQUE("payment_link")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recent_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"actor_id" text,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"message" text,
	"metadata" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_onboarding" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"dismissed" boolean NOT NULL,
	"dismissed_at" timestamp,
	"completed_at" timestamp,
	"steps" json NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_onboarding_user_id_unique" UNIQUE("user_id")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_token_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"feature" text,
	"token_limit" integer NOT NULL,
	"tokens_used" integer NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"reset_at" timestamp,
	"alert_threshold_percent" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ai_token_limits_org_user_feature_unique" UNIQUE("organization_id","user_id","feature")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"model" text,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"endpoint" text,
	"duration_ms" integer,
	"error_message" text,
	"metadata" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"alert_type" text NOT NULL,
	"threshold_percent" integer,
	"tokens_used" integer NOT NULL,
	"token_limit" integer NOT NULL,
	"notified_to" text,
	"is_read" boolean NOT NULL,
	"metadata" json,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"secret" text NOT NULL,
	"label" text,
	"is_active" boolean NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"automation_key" text NOT NULL,
	"items_found" integer,
	"emails_sent" integer,
	"emails_failed" integer,
	"errors" json,
	"triggered_by" text NOT NULL,
	"run_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"automation_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"schedule_hour_utc" integer,
	"last_scheduled_run_at" timestamp,
	CONSTRAINT "automation_settings_org_key" UNIQUE("organization_id","automation_key")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" text DEFAULT '' NOT NULL,
	"cover_image" text,
	"author_id" text,
	"author_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"category" text,
	"tags" json DEFAULT '[]'::json,
	"meta_title" text,
	"meta_description" text,
	"meta_keywords" text,
	"canonical_url" text,
	"og_image" text,
	"schema_markup" json,
	"faq" json,
	"view_count" integer DEFAULT 0 NOT NULL,
	"reading_time_min" integer,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_post_views" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"ip_hash" text,
	"referrer" text,
	"user_agent" text,
	"country" text,
	"created_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"date" timestamp NOT NULL,
	"start_hour" integer NOT NULL,
	"end_hour" integer NOT NULL,
	"calendar_type" text NOT NULL,
	"platform" text,
	"meet_link" text,
	"whatsapp_number" text,
	"outlook_event" text,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"google_event_id" text,
	"google_calendar_id" text,
	"sync_status" text,
	"last_sync_at" timestamp,
	"sync_direction" text,
	"google_event_data" json,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"subscribed" boolean NOT NULL,
	"subscribed_at" timestamp NOT NULL,
	"unsubscribed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email")
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_by" text NOT NULL,
	"project_title" text NOT NULL,
	"client_name" text NOT NULL,
	"company_name" text,
	"proposal_data" json,
	"status" text NOT NULL,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"signed_name" text,
	"signature_image" text,
	"signed_ip" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"due_date" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" text,
	"created_by" text,
	"is_global" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_template_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"estimated_hours" numeric(10, 2),
	"order" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_risk_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"risk_score" integer NOT NULL,
	"delay_risk" integer NOT NULL,
	"budget_risk" integer NOT NULL,
	"reasons" json NOT NULL,
	"overdue_task_titles" json,
	"status" text NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by" text,
	"next_eligible_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);

--> statement-breakpoint
-- Apply the original lead/client classification only when the legacy column is absent.
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'type') THEN
    ALTER TABLE clients ADD COLUMN type text NOT NULL DEFAULT 'lead';
    UPDATE clients SET type = 'client' WHERE status IN ('Contract Signed', 'Project In Progress', 'Completed');
  END IF;
END $migration$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_email" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_organization_owner" boolean;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_organization_manager" boolean;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subadmin_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selected_plan_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_organization_data" json;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" json;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "position" text;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "secret" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "backup_codes" json;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor_backup_codes" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor_backup_codes" ADD COLUMN IF NOT EXISTS "two_factor_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor_backup_codes" ADD COLUMN IF NOT EXISTS "code" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor_backup_codes" ADD COLUMN IF NOT EXISTS "used" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "two_factor_backup_codes" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "slug" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "custom_plan_name" text;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "price" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "billing_cycle" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "duration_value" integer;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "duration_type" text;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "trial_days" integer;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "features" json;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "paypal_plan_id" text;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "paypal_product_id" text;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "slug" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "logo" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "logo_public_id" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "website" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "industry" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "size" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "country" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_plan_id" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_status" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_start_date" timestamp;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscription_end_date" timestamp;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "max_users" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "max_projects" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "max_storage" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_leads" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_clients" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_webhooks" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_tasks" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_invoices" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_max_proposals" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "override_ai_token_limit" integer;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "settings" json;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "permissions" json;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "invited_by" text;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "invited_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "joined_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "first_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "last_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "contact_number" text;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "permission" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "password" text;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "logo" text;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "logo_public_id" text;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subadmin" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_number" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "assigned_to" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "start_date" timestamp;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "end_date" timestamp;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "progress" integer;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "budget" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "contractfile" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "contractfile_public_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_files" json;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "tags" json;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_fields" json;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "settings" json;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "content" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "parent_id" text;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "task_id" text;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_comments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigned_to" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "end_date" timestamp;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "start_after" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "finish_before" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "start_date" timestamp;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimated_hours" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "actual_hours" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "attachments" json;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_id" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "overdue_notified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "current_period_start" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_start" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_end" timestamp;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD COLUMN IF NOT EXISTS "series" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD COLUMN IF NOT EXISTS "last_value" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_number" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "date_paid" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "due_date" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "pdf_url" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "pdf_file_name" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "pdf_file_size" integer;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_url" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "overdue_notified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "plan_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "paypal_order_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "start_date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "end_date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "invoice_number" text;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_payment_requests" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "date" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "amount" numeric(12, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "category" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "source" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "project_id" text;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "invoice_id" text;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "revenue_entries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "client_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "template_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "client_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "frequency" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "start_date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "end_date" timestamp;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "last_run_date" timestamp;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "next_run_date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "expires_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "ip_address" text;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "account_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "provider_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "access_token" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refresh_token" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "id_token" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "scope" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "password" text;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "identifier" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "value" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "expires_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
--> statement-breakpoint
ALTER TABLE "verification" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "wait_time" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "ms_before_next" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "end_point" varchar(225);
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "allotted_points" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "consumed_points" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "remaining_points" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "key" varchar(225) PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "throttle_insight" ADD COLUMN IF NOT EXISTS "is_first_in_duration" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "firstname" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "lastname" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "companyname" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "phonenumber" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "userrole" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "setpermission" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "password" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "login_attempts" integer;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_management" ADD COLUMN IF NOT EXISTS "position" text;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "category" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "project_id" text;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "task_id" text;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "uploaded_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "file_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "url" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "size" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "version_number" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "uploaded_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "image" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "image_public_id" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "cpf_cnpj_number" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "business_industry" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "social_media_links" json;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "custom_fields" json;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "lead_value" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "lead_probability" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "last_interaction_at" timestamp;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "lead_temperature" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamp;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "follow_up_note" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "type" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "webhook_id" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "webhook_name" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "assigned_to" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "followup_notified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "portal_access_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "task_id" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "start_time" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "end_time" timestamp;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "duration" integer;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "billable" boolean;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "tags" json;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "invoice_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "time_entry_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "user_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "project_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "task_title" text;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "started_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "minutes" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_time_items" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "request_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "actor_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "request_hash" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "invoice_id" text;
--> statement-breakpoint
ALTER TABLE "time_invoicing_requests" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "message" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "data" json;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read" boolean;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "endpoint" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "p256dh" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "auth" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "client_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "content" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "client_interactions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "interaction_replies" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "interaction_replies" ADD COLUMN IF NOT EXISTS "interaction_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "interaction_replies" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "interaction_replies" ADD COLUMN IF NOT EXISTS "content" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "interaction_replies" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "options" json;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "required" boolean;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "position" integer;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_field_definitions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "org_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "source" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "active" boolean;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "field_mapping" json;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhooks" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "webhook_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "payload" json;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "lead_id" text;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "error" text;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "ip" text;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "max_retries" integer DEFAULT 3;
--> statement-breakpoint
ALTER TABLE "lead_webhook_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD COLUMN IF NOT EXISTS "color" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tags" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tag_assignments" ADD COLUMN IF NOT EXISTS "lead_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_tag_assignments" ADD COLUMN IF NOT EXISTS "tag_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "conditions" json NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "actions" json NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "lead_routing_rules" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "action" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resource" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resource_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "old_values" json;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_values" json;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "permissions" json;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "invited_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "expires_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "entity_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "options" json;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "ticket_number" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "subject" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "priority" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "submitted_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "submitted_by_role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "submitted_by_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "destination" text DEFAULT 'platform' NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "client" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "assigned_to" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "created_on" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "ticket_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "message" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "client_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "project" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "submitted_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "client_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "external_payment_url" text;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "status" text;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "reminder_notified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "payment_link" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "actor_id" text;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "action" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "resource" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "resource_id" text;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "message" text;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "recent_activities" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "dismissed" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "steps" json NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "feature" text;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "token_limit" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "tokens_used" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "period" text DEFAULT 'monthly' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "reset_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "alert_threshold_percent" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_token_limits" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "feature" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'openai' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "model" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "prompt_tokens" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "completion_tokens" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "total_tokens" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'success' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "endpoint" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "error_message" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "alert_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "threshold_percent" integer;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "tokens_used" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "token_limit" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "notified_to" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "is_read" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "metadata" json;
--> statement-breakpoint
ALTER TABLE "ai_usage_alerts" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "secret" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "automation_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "items_found" integer;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "emails_sent" integer;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "emails_failed" integer;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "errors" json;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "triggered_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "run_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "automation_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "schedule_hour_utc" integer;
--> statement-breakpoint
ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "last_scheduled_run_at" timestamp;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "slug" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "excerpt" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "content" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "cover_image" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "author_id" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "author_name" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "tags" json DEFAULT '[]'::json;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "meta_title" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "meta_description" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "meta_keywords" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "canonical_url" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "og_image" text;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "schema_markup" json;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "faq" json;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "view_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "reading_time_min" integer;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "featured" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "post_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "ip_hash" text;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "referrer" text;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "country" text;
--> statement-breakpoint
ALTER TABLE "blog_post_views" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "date" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "start_hour" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "end_hour" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "calendar_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "platform" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "meet_link" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "whatsapp_number" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "outlook_event" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "google_event_id" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "google_calendar_id" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "sync_status" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "sync_direction" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "google_event_data" json;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "email" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "subscribed" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "subscribed_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "unsubscribed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "client_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "created_by" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "project_title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "client_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "company_name" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "proposal_data" json;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_name" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signature_image" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_ip" text;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "due_date" timestamp;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "created_by" text;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "is_global" boolean NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_templates" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "template_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "estimated_hours" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "order" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template_tasks" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "project_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "organization_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "risk_score" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "delay_risk" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "budget_risk" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "reasons" json NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "overdue_task_titles" json;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "status" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "dismissed_by" text;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "next_eligible_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_risk_alerts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."users"'::regclass AND conname = 'users_email_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subscription_plans"'::regclass AND conname = 'subscription_plans_slug_unique') THEN
    ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_slug_unique" UNIQUE("slug");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."organizations"'::regclass AND conname = 'organizations_slug_unique') THEN
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_unique" UNIQUE("slug");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subadmin"'::regclass AND conname = 'subadmin_email_unique') THEN
    ALTER TABLE "subadmin" ADD CONSTRAINT "subadmin_email_unique" UNIQUE("email");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subscriptions"'::regclass AND conname = 'subscriptions_stripe_subscription_id_unique') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ DECLARE existing_pk text; existing_definition text; BEGIN
  SELECT conname, regexp_replace(pg_get_constraintdef(oid), '[[:space:]"\\]+', '', 'g') INTO existing_pk, existing_definition
  FROM pg_constraint WHERE conrelid = 'public."invoice_number_counters"'::regclass AND contype = 'p';
  IF existing_pk IS NULL THEN
    ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY("organization_id","series");
  ELSIF existing_definition <> 'PRIMARYKEY(organization_id,series)' THEN
    RAISE EXCEPTION 'Unexpected primary key on invoice_number_counters; migration requires manual review';
  ELSIF existing_pk <> 'invoice_number_counters_pkey' THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', 'invoice_number_counters', existing_pk, 'invoice_number_counters_pkey');
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_number_counters"'::regclass AND conname = 'invoice_number_counters_last_value_check') THEN
    ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_last_value_check" CHECK ("invoice_number_counters"."last_value" >= 0);
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoices"'::regclass AND conname = 'unique_invoice_number_per_org') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "unique_invoice_number_per_org" UNIQUE("invoice_number","organization_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."plan_payment_requests"'::regclass AND conname = 'plan_payment_requests_paypal_order_id_unique') THEN
    ALTER TABLE "plan_payment_requests" ADD CONSTRAINT "plan_payment_requests_paypal_order_id_unique" UNIQUE("paypal_order_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_invoice_id_unique') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_invoice_id_unique" UNIQUE("invoice_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."session"'::regclass AND conname = 'session_token_unique') THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_token_unique" UNIQUE("token");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."account"'::regclass AND conname = 'user_provider_unique') THEN
    ALTER TABLE "account" ADD CONSTRAINT "user_provider_unique" UNIQUE("user_id","provider_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_management"'::regclass AND conname = 'user_management_email_unique') THEN
    ALTER TABLE "user_management" ADD CONSTRAINT "user_management_email_unique" UNIQUE("email");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_time_entry_id_unique') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_time_entry_id_unique" UNIQUE("time_entry_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_minutes_check') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_minutes_check" CHECK ("invoice_time_items"."minutes" > 0);
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_hourly_rate_check') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_hourly_rate_check" CHECK ("invoice_time_items"."hourly_rate" > 0);
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_amount_check') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_amount_check" CHECK ("invoice_time_items"."amount" >= 0);
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ DECLARE existing_pk text; existing_definition text; BEGIN
  SELECT conname, regexp_replace(pg_get_constraintdef(oid), '[[:space:]"\\]+', '', 'g') INTO existing_pk, existing_definition
  FROM pg_constraint WHERE conrelid = 'public."time_invoicing_requests"'::regclass AND contype = 'p';
  IF existing_pk IS NULL THEN
    ALTER TABLE "time_invoicing_requests" ADD CONSTRAINT "time_invoicing_requests_organization_id_request_key_pk" PRIMARY KEY("organization_id","request_key");
  ELSIF existing_definition <> 'PRIMARYKEY(organization_id,request_key)' THEN
    RAISE EXCEPTION 'Unexpected primary key on time_invoicing_requests; migration requires manual review';
  ELSIF existing_pk <> 'time_invoicing_requests_organization_id_request_key_pk' THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', 'time_invoicing_requests', existing_pk, 'time_invoicing_requests_organization_id_request_key_pk');
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."push_subscriptions"'::regclass AND conname = 'push_subscriptions_endpoint_unique') THEN
    ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_webhooks"'::regclass AND conname = 'lead_webhooks_token_unique') THEN
    ALTER TABLE "lead_webhooks" ADD CONSTRAINT "lead_webhooks_token_unique" UNIQUE("token");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_tags"'::regclass AND conname = 'lead_tags_org_name_unique') THEN
    ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_org_name_unique" UNIQUE("organization_id","name");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ DECLARE existing_pk text; existing_definition text; BEGIN
  SELECT conname, regexp_replace(pg_get_constraintdef(oid), '[[:space:]"\\]+', '', 'g') INTO existing_pk, existing_definition
  FROM pg_constraint WHERE conrelid = 'public."lead_tag_assignments"'::regclass AND contype = 'p';
  IF existing_pk IS NULL THEN
    ALTER TABLE "lead_tag_assignments" ADD CONSTRAINT "lead_tag_assignments_lead_id_tag_id_pk" PRIMARY KEY("lead_id","tag_id");
  ELSIF existing_definition <> 'PRIMARYKEY(lead_id,tag_id)' THEN
    RAISE EXCEPTION 'Unexpected primary key on lead_tag_assignments; migration requires manual review';
  ELSIF existing_pk <> 'lead_tag_assignments_lead_id_tag_id_pk' THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', 'lead_tag_assignments', existing_pk, 'lead_tag_assignments_lead_id_tag_id_pk');
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invitations"'::regclass AND conname = 'invitations_token_unique') THEN
    ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_unique" UNIQUE("token");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."support_tickets"'::regclass AND conname = 'support_tickets_ticket_number_unique') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ticket_number_unique" UNIQUE("ticket_number");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."payment_links"'::regclass AND conname = 'payment_links_payment_link_unique') THEN
    ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_link_unique" UNIQUE("payment_link");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_onboarding"'::regclass AND conname = 'user_onboarding_user_id_unique') THEN
    ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_unique" UNIQUE("user_id");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_token_limits"'::regclass AND conname = 'ai_token_limits_org_user_feature_unique') THEN
    ALTER TABLE "ai_token_limits" ADD CONSTRAINT "ai_token_limits_org_user_feature_unique" UNIQUE("organization_id","user_id","feature");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."automation_settings"'::regclass AND conname = 'automation_settings_org_key') THEN
    ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_org_key" UNIQUE("organization_id","automation_key");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."blog_posts"'::regclass AND conname = 'blog_posts_slug_unique') THEN
    ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."newsletter_subscribers"'::regclass AND conname = 'newsletter_subscribers_email_unique') THEN
    ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email");
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."two_factor"'::regclass AND conname = 'two_factor_user_id_users_id_fk') THEN
    ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."two_factor_backup_codes"'::regclass AND conname = 'two_factor_backup_codes_two_factor_id_two_factor_id_fk') THEN
    ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_two_factor_id_two_factor_id_fk" FOREIGN KEY ("two_factor_id") REFERENCES "public"."two_factor"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."organizations"'::regclass AND conname = 'organizations_subscription_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_subscription_plan_id_subscription_plans_id_fk" FOREIGN KEY ("subscription_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_organizations"'::regclass AND conname = 'user_organizations_user_id_users_id_fk') THEN
    ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_organizations"'::regclass AND conname = 'user_organizations_organization_id_organizations_id_fk') THEN
    ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_organizations"'::regclass AND conname = 'user_organizations_invited_by_users_id_fk') THEN
    ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subadmin"'::regclass AND conname = 'subadmin_created_by_users_id_fk') THEN
    ALTER TABLE "subadmin" ADD CONSTRAINT "subadmin_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."projects"'::regclass AND conname = 'projects_client_id_clients_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."projects"'::regclass AND conname = 'projects_organization_id_organizations_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."projects"'::regclass AND conname = 'projects_created_by_users_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."projects"'::regclass AND conname = 'projects_assigned_to_users_id_fk') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_comments"'::regclass AND conname = 'project_comments_project_id_projects_id_fk') THEN
    ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_comments"'::regclass AND conname = 'project_comments_user_id_users_id_fk') THEN
    ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_comments"'::regclass AND conname = 'project_comments_task_id_tasks_id_fk') THEN
    ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."tasks"'::regclass AND conname = 'tasks_project_id_projects_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."tasks"'::regclass AND conname = 'tasks_assigned_to_users_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."tasks"'::regclass AND conname = 'tasks_created_by_users_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."tasks"'::regclass AND conname = 'tasks_parent_id_tasks_id_fk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subscriptions"'::regclass AND conname = 'subscriptions_organization_id_organizations_id_fk') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."subscriptions"'::regclass AND conname = 'subscriptions_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_number_counters"'::regclass AND conname = 'invoice_number_counters_organization_id_organizations_id_fk') THEN
    ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoices"'::regclass AND conname = 'invoices_organization_id_organizations_id_fk') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoices"'::regclass AND conname = 'invoices_client_id_clients_id_fk') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoices"'::regclass AND conname = 'invoices_created_by_users_id_fk') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."plan_payment_requests"'::regclass AND conname = 'plan_payment_requests_org_id_organizations_id_fk') THEN
    ALTER TABLE "plan_payment_requests" ADD CONSTRAINT "plan_payment_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."plan_payment_requests"'::regclass AND conname = 'plan_payment_requests_plan_id_subscription_plans_id_fk') THEN
    ALTER TABLE "plan_payment_requests" ADD CONSTRAINT "plan_payment_requests_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_organization_id_organizations_id_fk') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_client_id_clients_id_fk') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_project_id_projects_id_fk') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_invoice_id_invoices_id_fk') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."revenue_entries"'::regclass AND conname = 'revenue_entries_created_by_users_id_fk') THEN
    ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recurring_invoices"'::regclass AND conname = 'recurring_invoices_organization_id_organizations_id_fk') THEN
    ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recurring_invoices"'::regclass AND conname = 'recurring_invoices_client_id_clients_id_fk') THEN
    ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recurring_invoices"'::regclass AND conname = 'recurring_invoices_created_by_users_id_fk') THEN
    ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."session"'::regclass AND conname = 'session_user_id_users_id_fk') THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."account"'::regclass AND conname = 'account_user_id_users_id_fk') THEN
    ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_management"'::regclass AND conname = 'user_management_organization_id_organizations_id_fk') THEN
    ALTER TABLE "user_management" ADD CONSTRAINT "user_management_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_management"'::regclass AND conname = 'user_management_created_by_users_id_fk') THEN
    ALTER TABLE "user_management" ADD CONSTRAINT "user_management_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_expenses"'::regclass AND conname = 'project_expenses_project_id_projects_id_fk') THEN
    ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_expenses"'::regclass AND conname = 'project_expenses_created_by_users_id_fk') THEN
    ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."files"'::regclass AND conname = 'files_organization_id_organizations_id_fk') THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."files"'::regclass AND conname = 'files_project_id_projects_id_fk') THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."files"'::regclass AND conname = 'files_task_id_tasks_id_fk') THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."files"'::regclass AND conname = 'files_client_id_clients_id_fk') THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."files"'::regclass AND conname = 'files_uploaded_by_users_id_fk') THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."file_versions"'::regclass AND conname = 'file_versions_file_id_files_id_fk') THEN
    ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."file_versions"'::regclass AND conname = 'file_versions_uploaded_by_users_id_fk') THEN
    ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."clients"'::regclass AND conname = 'clients_organization_id_organizations_id_fk') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."clients"'::regclass AND conname = 'clients_user_id_users_id_fk') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."clients"'::regclass AND conname = 'clients_created_by_users_id_fk') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."clients"'::regclass AND conname = 'clients_assigned_to_users_id_fk') THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_entries"'::regclass AND conname = 'time_entries_user_id_users_id_fk') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_entries"'::regclass AND conname = 'time_entries_project_id_projects_id_fk') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_entries"'::regclass AND conname = 'time_entries_task_id_tasks_id_fk') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_entries"'::regclass AND conname = 'time_entries_client_id_clients_id_fk') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_invoice_id_invoices_id_fk') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invoice_time_items"'::regclass AND conname = 'invoice_time_items_time_entry_id_time_entries_id_fk') THEN
    ALTER TABLE "invoice_time_items" ADD CONSTRAINT "invoice_time_items_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_invoicing_requests"'::regclass AND conname = 'time_invoicing_requests_organization_id_organizations_id_fk') THEN
    ALTER TABLE "time_invoicing_requests" ADD CONSTRAINT "time_invoicing_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."time_invoicing_requests"'::regclass AND conname = 'time_invoicing_requests_invoice_id_invoices_id_fk') THEN
    ALTER TABLE "time_invoicing_requests" ADD CONSTRAINT "time_invoicing_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."notifications"'::regclass AND conname = 'notifications_user_id_users_id_fk') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."notifications"'::regclass AND conname = 'notifications_organization_id_organizations_id_fk') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."push_subscriptions"'::regclass AND conname = 'push_subscriptions_user_id_users_id_fk') THEN
    ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."client_interactions"'::regclass AND conname = 'client_interactions_client_id_clients_id_fk') THEN
    ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."client_interactions"'::regclass AND conname = 'client_interactions_user_id_users_id_fk') THEN
    ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."client_interactions"'::regclass AND conname = 'client_interactions_organization_id_organizations_id_fk') THEN
    ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."interaction_replies"'::regclass AND conname = 'interaction_replies_interaction_id_client_interactions_id_fk') THEN
    ALTER TABLE "interaction_replies" ADD CONSTRAINT "interaction_replies_interaction_id_client_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."client_interactions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."interaction_replies"'::regclass AND conname = 'interaction_replies_user_id_users_id_fk') THEN
    ALTER TABLE "interaction_replies" ADD CONSTRAINT "interaction_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_field_definitions"'::regclass AND conname = 'lead_field_definitions_org_id_organizations_id_fk') THEN
    ALTER TABLE "lead_field_definitions" ADD CONSTRAINT "lead_field_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_webhooks"'::regclass AND conname = 'lead_webhooks_org_id_organizations_id_fk') THEN
    ALTER TABLE "lead_webhooks" ADD CONSTRAINT "lead_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_webhook_logs"'::regclass AND conname = 'lead_webhook_logs_webhook_id_lead_webhooks_id_fk') THEN
    ALTER TABLE "lead_webhook_logs" ADD CONSTRAINT "lead_webhook_logs_webhook_id_lead_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."lead_webhooks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_tags"'::regclass AND conname = 'lead_tags_organization_id_organizations_id_fk') THEN
    ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_tag_assignments"'::regclass AND conname = 'lead_tag_assignments_lead_id_clients_id_fk') THEN
    ALTER TABLE "lead_tag_assignments" ADD CONSTRAINT "lead_tag_assignments_lead_id_clients_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_tag_assignments"'::regclass AND conname = 'lead_tag_assignments_tag_id_lead_tags_id_fk') THEN
    ALTER TABLE "lead_tag_assignments" ADD CONSTRAINT "lead_tag_assignments_tag_id_lead_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."lead_tags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."lead_routing_rules"'::regclass AND conname = 'lead_routing_rules_organization_id_organizations_id_fk') THEN
    ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."audit_logs"'::regclass AND conname = 'audit_logs_organization_id_organizations_id_fk') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."audit_logs"'::regclass AND conname = 'audit_logs_user_id_users_id_fk') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invitations"'::regclass AND conname = 'invitations_organization_id_organizations_id_fk') THEN
    ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."invitations"'::regclass AND conname = 'invitations_invited_by_users_id_fk') THEN
    ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."custom_field_definitions"'::regclass AND conname = 'custom_field_definitions_organization_id_organizations_id_fk') THEN
    ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."support_tickets"'::regclass AND conname = 'support_tickets_submitted_by_users_id_fk') THEN
    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."support_ticket_messages"'::regclass AND conname = 'support_ticket_messages_ticket_id_support_tickets_id_fk') THEN
    ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."support_ticket_messages"'::regclass AND conname = 'support_ticket_messages_sender_id_users_id_fk') THEN
    ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."payment_links"'::regclass AND conname = 'payment_links_organization_id_organizations_id_fk') THEN
    ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."payment_links"'::regclass AND conname = 'payment_links_client_id_clients_id_fk') THEN
    ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."payment_links"'::regclass AND conname = 'payment_links_project_id_projects_id_fk') THEN
    ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."payment_links"'::regclass AND conname = 'payment_links_created_by_users_id_fk') THEN
    ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recent_activities"'::regclass AND conname = 'recent_activities_organization_id_organizations_id_fk') THEN
    ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recent_activities"'::regclass AND conname = 'recent_activities_user_id_users_id_fk') THEN
    ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."recent_activities"'::regclass AND conname = 'recent_activities_actor_id_users_id_fk') THEN
    ALTER TABLE "recent_activities" ADD CONSTRAINT "recent_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."user_onboarding"'::regclass AND conname = 'user_onboarding_user_id_users_id_fk') THEN
    ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_token_limits"'::regclass AND conname = 'ai_token_limits_organization_id_organizations_id_fk') THEN
    ALTER TABLE "ai_token_limits" ADD CONSTRAINT "ai_token_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_token_limits"'::regclass AND conname = 'ai_token_limits_user_id_users_id_fk') THEN
    ALTER TABLE "ai_token_limits" ADD CONSTRAINT "ai_token_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_usage_logs"'::regclass AND conname = 'ai_usage_logs_organization_id_organizations_id_fk') THEN
    ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_usage_logs"'::regclass AND conname = 'ai_usage_logs_user_id_users_id_fk') THEN
    ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_usage_alerts"'::regclass AND conname = 'ai_usage_alerts_organization_id_organizations_id_fk') THEN
    ALTER TABLE "ai_usage_alerts" ADD CONSTRAINT "ai_usage_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."ai_usage_alerts"'::regclass AND conname = 'ai_usage_alerts_user_id_users_id_fk') THEN
    ALTER TABLE "ai_usage_alerts" ADD CONSTRAINT "ai_usage_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."webhook_secrets"'::regclass AND conname = 'webhook_secrets_organization_id_organizations_id_fk') THEN
    ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."automation_runs"'::regclass AND conname = 'automation_runs_organization_id_organizations_id_fk') THEN
    ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."automation_settings"'::regclass AND conname = 'automation_settings_organization_id_organizations_id_fk') THEN
    ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."blog_posts"'::regclass AND conname = 'blog_posts_author_id_users_id_fk') THEN
    ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."blog_post_views"'::regclass AND conname = 'blog_post_views_post_id_blog_posts_id_fk') THEN
    ALTER TABLE "blog_post_views" ADD CONSTRAINT "blog_post_views_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."calendar_events"'::regclass AND conname = 'calendar_events_user_id_users_id_fk') THEN
    ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."proposals"'::regclass AND conname = 'proposals_organization_id_organizations_id_fk') THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."proposals"'::regclass AND conname = 'proposals_client_id_clients_id_fk') THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."proposals"'::regclass AND conname = 'proposals_created_by_users_id_fk') THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_milestones"'::regclass AND conname = 'project_milestones_project_id_projects_id_fk') THEN
    ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_milestones"'::regclass AND conname = 'project_milestones_organization_id_organizations_id_fk') THEN
    ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_templates"'::regclass AND conname = 'project_templates_organization_id_organizations_id_fk') THEN
    ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_templates"'::regclass AND conname = 'project_templates_created_by_users_id_fk') THEN
    ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_template_tasks"'::regclass AND conname = 'project_template_tasks_template_id_project_templates_id_fk') THEN
    ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_template_id_project_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_risk_alerts"'::regclass AND conname = 'project_risk_alerts_project_id_projects_id_fk') THEN
    ALTER TABLE "project_risk_alerts" ADD CONSTRAINT "project_risk_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_risk_alerts"'::regclass AND conname = 'project_risk_alerts_organization_id_organizations_id_fk') THEN
    ALTER TABLE "project_risk_alerts" ADD CONSTRAINT "project_risk_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public."project_risk_alerts"'::regclass AND conname = 'project_risk_alerts_dismissed_by_users_id_fk') THEN
    ALTER TABLE "project_risk_alerts" ADD CONSTRAINT "project_risk_alerts_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $migration$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_super_admin_idx" ON "users" USING btree ("is_super_admin");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_plans_slug_idx" ON "subscription_plans" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_plans_active_idx" ON "subscription_plans" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_status_idx" ON "organizations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_subscription_idx" ON "organizations" USING btree ("subscription_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_organizations_user_org_idx" ON "user_organizations" USING btree ("user_id","organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_organizations_role_idx" ON "user_organizations" USING btree ("role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_organizations_status_idx" ON "user_organizations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_organization_idx" ON "projects" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_created_by_idx" ON "projects" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_client_idx" ON "projects" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_assigned_to_idx" ON "projects" USING btree ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_project_number_idx" ON "projects" USING btree ("project_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_id_idx" ON "projects" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_position_idx" ON "projects" USING btree ("position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_project_idx" ON "project_comments" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_user_idx" ON "project_comments" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_parent_idx" ON "project_comments" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_task_idx" ON "project_comments" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_comments_created_at_idx" ON "project_comments" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_idx" ON "tasks" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks" USING btree ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_end_date_idx" ON "tasks" USING btree ("end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_parent_id_idx" ON "tasks" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_organization_idx" ON "subscriptions" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_organization_idx" ON "invoices" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_client_idx" ON "invoices" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_created_by_idx" ON "invoices" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_payment_requests_org_idx" ON "plan_payment_requests" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_payment_requests_status_idx" ON "plan_payment_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_payment_requests_order_idx" ON "plan_payment_requests" USING btree ("paypal_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_entries_org_idx" ON "revenue_entries" USING btree ("organization_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_entries_client_idx" ON "revenue_entries" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_entries_source_idx" ON "revenue_entries" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoices_organization_idx" ON "recurring_invoices" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoices_client_idx" ON "recurring_invoices" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoices_status_idx" ON "recurring_invoices" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoices_next_run_idx" ON "recurring_invoices" USING btree ("next_run_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_management_email_idx" ON "user_management" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_management_organization_idx" ON "user_management" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_management_status_idx" ON "user_management" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_management_role_idx" ON "user_management" USING btree ("userrole");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_expenses_project_idx" ON "project_expenses" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_expenses_category_idx" ON "project_expenses" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_expenses_date_idx" ON "project_expenses" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_organization_idx" ON "files" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_project_idx" ON "files" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_task_idx" ON "files" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_client_idx" ON "files" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_versions_file_idx" ON "file_versions" USING btree ("file_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_versions_version_idx" ON "file_versions" USING btree ("version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_organization_idx" ON "clients" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_user_idx" ON "clients" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_status_idx" ON "clients" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_email_idx" ON "clients" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_email_org_idx" ON "clients" USING btree ("email","organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_position_idx" ON "clients" USING btree ("position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_assigned_to_idx" ON "clients" USING btree ("assigned_to","organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_idx" ON "time_entries" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_project_idx" ON "time_entries" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_task_idx" ON "time_entries" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_start_time_idx" ON "time_entries" USING btree ("start_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_time_items_invoice_idx" ON "invoice_time_items" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_read_idx" ON "notifications" USING btree ("read");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_type_idx" ON "notifications" USING btree ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_interactions_client_idx" ON "client_interactions" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_interactions_type_idx" ON "client_interactions" USING btree ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_interactions_created_at_idx" ON "client_interactions" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interaction_replies_interaction_idx" ON "interaction_replies" USING btree ("interaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_field_definitions_org_idx" ON "lead_field_definitions" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_webhooks_org_idx" ON "lead_webhooks" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_webhook_logs_webhook_idx" ON "lead_webhook_logs" USING btree ("webhook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_webhook_logs_created_at_idx" ON "lead_webhook_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_webhook_logs_retry_idx" ON "lead_webhook_logs" USING btree ("status","next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_tags_org_idx" ON "lead_tags" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_tag_assignments_tag_idx" ON "lead_tag_assignments" USING btree ("tag_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_routing_rules_org_idx" ON "lead_routing_rules" USING btree ("organization_id","priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_organization_idx" ON "audit_logs" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" USING btree ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_organization_idx" ON "invitations" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "invitations" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_token_idx" ON "invitations" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_status_idx" ON "invitations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_definitions_org_idx" ON "custom_field_definitions" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_definitions_entity_type_idx" ON "custom_field_definitions" USING btree ("entity_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_number_idx" ON "support_tickets" USING btree ("ticket_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_idx" ON "support_tickets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priority_idx" ON "support_tickets" USING btree ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submitted_by_idx" ON "support_tickets" USING btree ("submitted_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_messages_ticket_id_idx" ON "support_ticket_messages" USING btree ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_messages_sender_id_idx" ON "support_ticket_messages" USING btree ("sender_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_organization_idx" ON "payment_links" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_client_idx" ON "payment_links" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_project_idx" ON "payment_links" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_created_by_idx" ON "payment_links" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_payment_link_idx" ON "payment_links" USING btree ("payment_link");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recent_activities_org_idx" ON "recent_activities" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recent_activities_actor_idx" ON "recent_activities" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recent_activities_type_idx" ON "recent_activities" USING btree ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recent_activities_res_idx" ON "recent_activities" USING btree ("resource");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_onboarding_user_idx" ON "user_onboarding" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_onboarding_role_idx" ON "user_onboarding" USING btree ("role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_token_limits_organization_idx" ON "ai_token_limits" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_token_limits_user_idx" ON "ai_token_limits" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_organization_idx" ON "ai_usage_logs" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_user_idx" ON "ai_usage_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_feature_idx" ON "ai_usage_logs" USING btree ("feature");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_created_at_idx" ON "ai_usage_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_status_idx" ON "ai_usage_logs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_alerts_organization_idx" ON "ai_usage_alerts" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_alerts_user_idx" ON "ai_usage_alerts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_secrets_organization_idx" ON "webhook_secrets" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_org_key_idx" ON "automation_runs" USING btree ("organization_id","automation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_run_at_idx" ON "automation_runs" USING btree ("run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_settings_org_idx" ON "automation_settings" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_organization_idx" ON "calendar_events" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_user_idx" ON "calendar_events" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_date_idx" ON "calendar_events" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_calendar_type_idx" ON "calendar_events" USING btree ("calendar_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_email_idx" ON "newsletter_subscribers" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_subscribed_idx" ON "newsletter_subscribers" USING btree ("subscribed");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_organization_idx" ON "proposals" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_client_idx" ON "proposals" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_status_idx" ON "proposals" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_created_by_idx" ON "proposals" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_org_idx" ON "project_milestones" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_templates_organization_idx" ON "project_templates" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_templates_global_idx" ON "project_templates" USING btree ("is_global");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_tasks_template_idx" ON "project_template_tasks" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_risk_alerts_project_idx" ON "project_risk_alerts" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_risk_alerts_org_idx" ON "project_risk_alerts" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_risk_alerts_status_idx" ON "project_risk_alerts" USING btree ("status");

-- The per-organization unique constraint above replaces the retired global constraint.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_unique;
