CREATE TABLE IF NOT EXISTS "agent_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"agent" "agent_name" NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"confidence" numeric(4, 3),
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_at" timestamp with time zone,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_evidence_execution_id_idx" ON "agent_evidence" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_evidence_agent_idx" ON "agent_evidence" USING btree ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_evidence_client_id_idx" ON "agent_evidence" USING btree ("client_id");