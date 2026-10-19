CREATE TABLE IF NOT EXISTS "client_google_ads_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"login_customer_id" text,
	"connection_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_google_ads_accounts_client_id_customer_id_unique" UNIQUE("client_id","customer_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_google_ads_accounts" ADD CONSTRAINT "client_google_ads_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_google_ads_accounts" ADD CONSTRAINT "client_google_ads_accounts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_google_ads_accounts_client_id_idx" ON "client_google_ads_accounts" USING btree ("client_id");