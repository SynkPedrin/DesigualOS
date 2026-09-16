CREATE TABLE IF NOT EXISTS "integration_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"stale_after_minutes" integer DEFAULT 360 NOT NULL,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_health_source_unique" UNIQUE("source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" uuid,
	"campaign_id" uuid,
	"user_id" uuid,
	"agent" text,
	"conversation_id" uuid,
	"execution_id" text,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"importance" text DEFAULT '0.500' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_episodes_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text NOT NULL,
	"type" text NOT NULL,
	"client_id" uuid,
	"campaign_id" uuid,
	"requested_context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hop" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_blackboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"client_id" uuid,
	"campaign_id" uuid,
	"objective" text,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_blackboards_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_episodes" ADD CONSTRAINT "agent_episodes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_episodes" ADD CONSTRAINT "agent_episodes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_episodes" ADD CONSTRAINT "agent_episodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_blackboards" ADD CONSTRAINT "execution_blackboards_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "execution_blackboards" ADD CONSTRAINT "execution_blackboards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_health_source_idx" ON "integration_health" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_episodes_occurred_at_idx" ON "agent_episodes" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_episodes_client_id_idx" ON "agent_episodes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_episodes_user_id_idx" ON "agent_episodes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_episodes_environment_idx" ON "agent_episodes" USING btree ("environment");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_execution_id_idx" ON "agent_messages" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_type_idx" ON "agent_messages" USING btree ("type");