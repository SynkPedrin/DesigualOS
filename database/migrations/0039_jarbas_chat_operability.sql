CREATE TABLE IF NOT EXISTS "client_meta_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_meta_accounts_client_id_account_id_unique" UNIQUE("client_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_meta_accounts" ADD CONSTRAINT "client_meta_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_meta_accounts_client_id_idx" ON "client_meta_accounts" USING btree ("client_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_org_client_conversation_idx" ON "agent_tasks" USING btree ("organization_id","client_id","conversation_id");