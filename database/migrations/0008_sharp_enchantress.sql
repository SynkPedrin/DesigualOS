CREATE TABLE IF NOT EXISTS "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"external_workspace_id" text,
	"external_workspace_name" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_user_id_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "clickup_space_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_clickup_space_id_unique" UNIQUE("clickup_space_id");