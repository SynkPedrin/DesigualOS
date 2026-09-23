-- NOTA (24/09/2026): o gerador (drizzle-kit generate) tentou recriar
-- organizations/organization_members/clients.organization_id/
-- automations.organization_id porque os snapshots 0035-0037 (migração
-- de fundação de tenant, já aplicada em produção) não estão commitados em
-- database/migrations/meta/ nesta branch — lacuna pré-existente, não
-- causada por esta missão. Este arquivo foi editado à mão pra conter só o
-- que é novo: agent_tasks + agent_task_results. Rodar db:generate de novo
-- no futuro vai repetir esse mesmo falso-positivo até os snapshots 0035-
-- 0037 serem reconstruídos — reportado separadamente, não corrigido aqui.

DO $$ BEGIN
 CREATE TYPE "public"."agent_task_status" AS ENUM('assigned', 'acknowledged', 'context_resolved', 'data_required', 'analyzing', 'verifying', 'completed_analysis', 'ready_for_review', 'blocked_needs_data', 'blocked_ambiguous', 'blocked_permission', 'blocked_external_service', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"requested_by" uuid,
	"assigned_agent" text DEFAULT 'jarbas' NOT NULL,
	"objective" text NOT NULL,
	"scope" text NOT NULL,
	"entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_window_start" text,
	"time_window_end" text,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_user_request" text NOT NULL,
	"status" "agent_task_status" DEFAULT 'assigned' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"next_eligible_retry_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tasks_dispatch_key_unique" UNIQUE("dispatch_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_task_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_task_results_task_id_version_unique" UNIQUE("task_id","task_version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_task_results" ADD CONSTRAINT "agent_task_results_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_organization_id_idx" ON "agent_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_client_id_idx" ON "agent_tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_updated_at_idx" ON "agent_tasks" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_next_eligible_retry_at_idx" ON "agent_tasks" USING btree ("next_eligible_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_results_task_id_idx" ON "agent_task_results" USING btree ("task_id");
--> statement-breakpoint
-- Mesma cerca de acesso público que 0037_restrict_public_data_api.sql já
-- aplica às demais tabelas de aplicação — tabela nova não pode ficar
-- exposta ao PostgREST (anon/authenticated) por omissão.
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'agent_tasks', principal);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', 'agent_task_results', principal);
    END IF;
  END LOOP;
  REVOKE ALL ON TABLE public.agent_tasks FROM PUBLIC;
  REVOKE ALL ON TABLE public.agent_task_results FROM PUBLIC;
END $$;
