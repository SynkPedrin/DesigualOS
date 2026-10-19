ALTER TABLE "client_meta_accounts" ADD COLUMN "business_id" text;--> statement-breakpoint
ALTER TABLE "client_meta_accounts" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_meta_accounts" ADD CONSTRAINT "client_meta_accounts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
