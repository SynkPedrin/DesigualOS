ALTER TABLE "cost_records" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_records_organization_id_idx" ON "cost_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_usage_organization_id_idx" ON "token_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_parent_id_idx" ON "organizations" USING btree ("parent_id");