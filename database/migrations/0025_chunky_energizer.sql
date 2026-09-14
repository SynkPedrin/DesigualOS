CREATE TABLE IF NOT EXISTS "agent_execution_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"agent" "agent_name" NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"conversation_id" uuid,
	"phase" text NOT NULL,
	"task_class" text,
	"iterations" integer DEFAULT 0 NOT NULL,
	"evaluator_score" numeric(4, 3),
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_execution_states_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"agent" "agent_name" NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"conversation_id" uuid,
	"goal_completion" boolean NOT NULL,
	"first_attempt_success" boolean NOT NULL,
	"iterations" integer NOT NULL,
	"tool_failures" integer DEFAULT 0 NOT NULL,
	"evaluator_score" numeric(4, 3),
	"latency_ms" integer,
	"task_class" text,
	"user_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_outcomes_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_execution_states" ADD CONSTRAINT "agent_execution_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_execution_states" ADD CONSTRAINT "agent_execution_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_outcomes" ADD CONSTRAINT "agent_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_outcomes" ADD CONSTRAINT "agent_outcomes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_execution_states_agent_idx" ON "agent_execution_states" USING btree ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_execution_states_user_id_idx" ON "agent_execution_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_execution_states_client_id_idx" ON "agent_execution_states" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outcomes_agent_idx" ON "agent_outcomes" USING btree ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outcomes_client_id_idx" ON "agent_outcomes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_outcomes_created_at_idx" ON "agent_outcomes" USING btree ("created_at");