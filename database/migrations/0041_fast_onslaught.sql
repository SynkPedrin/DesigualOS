CREATE TABLE IF NOT EXISTS "motion_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"motion_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"quality" text NOT NULL,
	"storage_url" text,
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"fps" integer,
	"size_bytes" integer,
	"render_time_ms" integer,
	"quality_score" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motion_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"conversation_id" uuid,
	"project_id" uuid,
	"requested_by" uuid,
	"workspace_path" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage_detail" text,
	"prompt" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"fps" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"format" text NOT NULL,
	"model" text NOT NULL,
	"render_version" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_renders" ADD CONSTRAINT "motion_renders_motion_session_id_motion_sessions_id_fk" FOREIGN KEY ("motion_session_id") REFERENCES "public"."motion_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_sessions" ADD CONSTRAINT "motion_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_sessions" ADD CONSTRAINT "motion_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_sessions" ADD CONSTRAINT "motion_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "motion_sessions" ADD CONSTRAINT "motion_sessions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motion_renders_session_id_idx" ON "motion_renders" USING btree ("motion_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motion_sessions_client_id_idx" ON "motion_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motion_sessions_conversation_id_idx" ON "motion_sessions" USING btree ("conversation_id");--> statement-breakpoint
-- Mesma regra da 0037: tabela nova em `public` nasce exposta pela data API do
-- Supabase (PostgREST). As duas são lidas só pelo Fastify e pelo worker, e
-- `motion_sessions.workspace_path` é caminho de filesystem do worker — dado
-- que não tem por que sair daqui. Revoga na mesma migration que cria, pra não
-- existir janela nenhuma em que ficaram abertas.
DO $$
DECLARE resource text; principal text;
BEGIN
  FOREACH resource IN ARRAY ARRAY['motion_sessions', 'motion_renders'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', resource);
    FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', resource, principal);
      END IF;
    END LOOP;
  END LOOP;
END $$;
