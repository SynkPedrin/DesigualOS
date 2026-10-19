CREATE TABLE IF NOT EXISTS "operational_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"actor_type" text NOT NULL,
	"person_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_identities_org_source_external_unique" UNIQUE("organization_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operational_identity_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_identity_members_unique" UNIQUE("identity_id","person_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operational_identities" ADD CONSTRAINT "operational_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operational_identities" ADD CONSTRAINT "operational_identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operational_identity_members" ADD CONSTRAINT "operational_identity_members_identity_id_operational_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."operational_identities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operational_identity_members" ADD CONSTRAINT "operational_identity_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_identities_organization_id_idx" ON "operational_identities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_identities_person_id_idx" ON "operational_identities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_identity_members_identity_id_idx" ON "operational_identity_members" USING btree ("identity_id");