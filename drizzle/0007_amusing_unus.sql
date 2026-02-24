CREATE TABLE "custom_field_definitions" (
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
ALTER TABLE "projects" ADD COLUMN "custom_fields" json;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_definitions_org_idx" ON "custom_field_definitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_entity_type_idx" ON "custom_field_definitions" USING btree ("entity_type");