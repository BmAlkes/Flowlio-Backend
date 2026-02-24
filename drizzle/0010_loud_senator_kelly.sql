ALTER TABLE "clients" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "custom_fields" json;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_organization_manager" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_user_idx" ON "clients" USING btree ("user_id");