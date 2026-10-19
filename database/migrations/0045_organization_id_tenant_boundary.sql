-- 0045_organization_id_tenant_boundary.sql — fronteira de organização direta
-- nas seis tabelas de CONTEÚDO que não tinham nenhuma.
--
-- MEDIDO em 30/09/2026, não suposto: de 77 tabelas, 9 já tinham organization_id
-- (clients, audit_logs, operational_events, mcp_sessions, mcp_tokens,
-- organization_members, agent_tasks, ai_usage_ledger, automations). As seis
-- que faltavam são justamente as de CONTEÚDO — memories, proactive_signals,
-- agent_episodes, conversations, messages, executions — isoladas hoje só
-- INDIRETAMENTE, por client_id -> clients.organization_id ou por user_id ->
-- organization_members. Essa convenção já vazou duas vezes no mesmo dia desta
-- migração (anotação privada visível entre pessoas, em duas portas distintas
-- pra memories). Numa organização só, o preço de esquecer o salto é
-- constrangimento. Em multi-tenant, é contrato quebrado entre empresas.
--
-- ADITIVA POR CONSTRUÇÃO, mesmo padrão da 0044: nenhuma coluna existente muda
-- de tipo, nenhuma é removida. organization_id nasce NULLABLE em todas as seis
-- — não vira NOT NULL aqui. Ficar nulo é o resultado CORRETO para uma linha
-- que não resolve por client_id nem por user_id: carimbar por dedução (supor
-- que é sempre a única organização hoje) trocaria um vazamento por um dado
-- errado sem jeito de descobrir depois. Ver a UPDATE de diagnóstico no final.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. COLUNA NOVA, NULLABLE, NAS SEIS TABELAS
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "proactive_signals" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_episodes" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "organization_id" uuid;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 2. FOREIGN KEYS (idempotentes — não falham se já existirem)
-- ─────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proactive_signals" ADD CONSTRAINT "proactive_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_episodes" ADD CONSTRAINT "agent_episodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "executions" ADD CONSTRAINT "executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ÍNDICES
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "memories_organization_id_idx" ON "memories" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_signals_organization_id_idx" ON "proactive_signals" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_episodes_organization_id_idx" ON "agent_episodes" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_organization_id_idx" ON "conversations" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_organization_id_idx" ON "messages" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "executions_organization_id_idx" ON "executions" ("organization_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL — materializa o vínculo que já existe, não inventa um novo.
--
-- Ordem importa: conversations precisa ser preenchida ANTES de messages, que
-- deriva dela (messages não tem client_id nem user_id próprio).
--
-- SEM fallback pra "organização única" quando client_id/user_id não resolve.
-- Uma linha que não resolve por nenhum caminho fica NULL — visível e
-- investigável — em vez de carimbada por suposição.
-- ─────────────────────────────────────────────────────────────────────────

-- memories: client_id primeiro (mais específico), user_id como reforço pra
-- quem sobrar sem client_id (ex: nota pessoal sem cliente).
UPDATE "memories" m SET "organization_id" = c."organization_id"
  FROM "clients" c WHERE m."client_id" = c."id" AND m."organization_id" IS NULL;--> statement-breakpoint
UPDATE "memories" m SET "organization_id" = om."organization_id"
  FROM "organization_members" om WHERE m."user_id" = om."user_id" AND m."organization_id" IS NULL;--> statement-breakpoint

UPDATE "proactive_signals" s SET "organization_id" = c."organization_id"
  FROM "clients" c WHERE s."client_id" = c."id" AND s."organization_id" IS NULL;--> statement-breakpoint

UPDATE "agent_episodes" e SET "organization_id" = c."organization_id"
  FROM "clients" c WHERE e."client_id" = c."id" AND e."organization_id" IS NULL;--> statement-breakpoint
UPDATE "agent_episodes" e SET "organization_id" = om."organization_id"
  FROM "organization_members" om WHERE e."user_id" = om."user_id" AND e."organization_id" IS NULL;--> statement-breakpoint

-- conversations: user_id é NOT NULL na tabela, então resolve sempre que a
-- pessoa for membro de alguma organização — client_id primeiro por ser mais
-- específico quando presente.
UPDATE "conversations" v SET "organization_id" = c."organization_id"
  FROM "clients" c WHERE v."client_id" = c."id" AND v."organization_id" IS NULL;--> statement-breakpoint
UPDATE "conversations" v SET "organization_id" = om."organization_id"
  FROM "organization_members" om WHERE v."user_id" = om."user_id" AND v."organization_id" IS NULL;--> statement-breakpoint

-- messages: só resolve através da conversa dona.
UPDATE "messages" msg SET "organization_id" = v."organization_id"
  FROM "conversations" v WHERE msg."conversation_id" = v."id" AND msg."organization_id" IS NULL;--> statement-breakpoint

-- executions: user_id é NOT NULL, mesma lógica de conversations.
UPDATE "executions" x SET "organization_id" = c."organization_id"
  FROM "clients" c WHERE x."client_id" = c."id" AND x."organization_id" IS NULL;--> statement-breakpoint
UPDATE "executions" x SET "organization_id" = om."organization_id"
  FROM "organization_members" om WHERE x."user_id" = om."user_id" AND x."organization_id" IS NULL;--> statement-breakpoint
