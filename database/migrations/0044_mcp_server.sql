-- 0044_mcp_server.sql — DESIGUAL OS MCP: autorização, sessão e auditoria.
--
-- ADITIVA POR CONSTRUÇÃO. Nenhuma coluna existente muda de tipo, nenhuma é
-- removida, nenhuma vira NOT NULL. Rodar isto num banco sem o MCP no ar não
-- altera comportamento nenhum — as tabelas nascem vazias e as colunas novas
-- nascem nulas.
--
-- Três grupos:
--   1. OAuth do MCP (clientes registrados, tokens, sessões)
--   2. Auditoria com o detalhe que a §12 exige (hoje tudo cabia em jsonb)
--   3. Evento de NEGÓCIO em operational_events (hoje só existe evento de webhook)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. OAUTH DO MCP
-- ─────────────────────────────────────────────────────────────────────────

-- Cliente OAuth registrado dinamicamente pelo Claude (RFC 7591). Um registro
-- por superfície que conecta (Claude Web, Claude Desktop, ...).
CREATE TABLE IF NOT EXISTS "mcp_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	-- Hash do secret, nunca o secret. Clientes públicos (PKCE) ficam nulos aqui.
	"client_secret_hash" text,
	"client_name" text,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grant_types" jsonb DEFAULT '["authorization_code","refresh_token"]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint

-- Código de autorização (vida curta) e tokens. Uma linha por concessão.
--
-- O token NUNCA é guardado em claro: só o hash. Quem tem o banco não consegue
-- se passar por um funcionário — que é exatamente o cenário que uma API key
-- global exposta no cliente criaria (proibido pela §4).
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- 'authorization_code' | 'access' | 'refresh'
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- PKCE: guardado no código, conferido na troca.
	"code_challenge" text,
	"redirect_uri" text,
	"resource" text,
	-- Encadeia access -> refresh que o emitiu, para revogar a família inteira.
	"parent_token_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint

-- Sessão MCP: a unidade de correlação entre chamadas do mesmo Claude.
CREATE TABLE IF NOT EXISTS "mcp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" text,
	"transport_session_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_sessions" ADD CONSTRAINT "mcp_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_sessions" ADD CONSTRAINT "mcp_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_kind_expires_idx" ON "mcp_tokens" ("kind","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_sessions_user_id_idx" ON "mcp_sessions" ("user_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 2. AUDITORIA COM DETALHE (§12)
-- ─────────────────────────────────────────────────────────────────────────
-- Hoje `audit_logs` tem user_id, action, agent, client_id, timestamp, result e
-- metadata. Dá para responder "quem alterou", não dá para responder "o que era
-- antes" nem para correlacionar uma requisição sem varrer jsonb.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "tool" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resource_type" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resource_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "old_value" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "new_value" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "session_id" uuid;--> statement-breakpoint
-- 'mcp' | 'web' | 'worker' | 'webhook' — responde "foi Bento, Claude ou humano?"
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_request_id_idx" ON "audit_logs" ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" ("resource_type","resource_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 3. EVENTO DE NEGÓCIO (§5-D)
-- ─────────────────────────────────────────────────────────────────────────
-- `operational_events` existe e é idempotente por (source, external_id), mas em
-- 29/09/2026 tinha 633 linhas e DOIS tipos, os dois do webhook do ClickUp.
-- Nenhum evento jamais foi registrado por uma pessoa ou por um agente.
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "user_id" uuid;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "project_id" uuid;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "task_id" text;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "importance" text DEFAULT 'LOW';--> statement-breakpoint
ALTER TABLE "operational_events" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'TEAM';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_events_org_occurred_idx" ON "operational_events" ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_events_user_idx" ON "operational_events" ("user_id");
