CREATE TABLE IF NOT EXISTS "ai_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"agent" "agent_name",
	"conversation_id" uuid,
	"model" text NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"request_type" text NOT NULL,
	"tool_steps" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_ledger_created_at_idx" ON "ai_usage_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_ledger_org_created_at_idx" ON "ai_usage_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_ledger_agent_idx" ON "ai_usage_ledger" USING btree ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_ledger_model_idx" ON "ai_usage_ledger" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_ledger_conversation_id_idx" ON "ai_usage_ledger" USING btree ("conversation_id");