CREATE TABLE "member_capacity" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"weekly_minutes" integer,
	"team" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_capacity_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "member_capacity_minutes_check" CHECK ("member_capacity"."weekly_minutes" >= 0 AND "member_capacity"."weekly_minutes" <= 10080)
);
--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;