CREATE TABLE IF NOT EXISTS "entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"desigual_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_org_source_type_external_unique" UNIQUE("organization_id","source","entity_type","external_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_links_organization_id_idx" ON "entity_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_links_desigual_id_idx" ON "entity_links" USING btree ("desigual_id");