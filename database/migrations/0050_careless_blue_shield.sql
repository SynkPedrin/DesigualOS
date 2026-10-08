CREATE TABLE IF NOT EXISTS "organization_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"status" text DEFAULT 'ativa' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_connectors_organization_id_provider_unique" UNIQUE("organization_id","provider")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_connectors" ADD CONSTRAINT "organization_connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_connectors_organization_id_idx" ON "organization_connectors" USING btree ("organization_id");