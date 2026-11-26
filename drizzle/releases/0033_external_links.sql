CREATE TABLE "external_links" (
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_links_organization_id_source_entity_type_external_id_pk" PRIMARY KEY("organization_id","source","entity_type","external_id"),
	CONSTRAINT "external_links_kind_check" CHECK ("external_links"."source" in ('monday') and "external_links"."entity_type" in ('project','task'))
);
--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_links_entity_idx" ON "external_links" USING btree ("entity_type","entity_id");