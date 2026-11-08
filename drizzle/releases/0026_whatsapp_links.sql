-- Additive: WhatsApp numbers linked to Flowlio users for Lio on WhatsApp.
CREATE TABLE IF NOT EXISTS "whatsapp_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone" text,
	"language" text DEFAULT 'pt' NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"conversation_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_links_phone_unique" UNIQUE("phone"),
	CONSTRAINT "whatsapp_links_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "whatsapp_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "whatsapp_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);
