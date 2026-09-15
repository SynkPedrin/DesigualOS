-- Migration PRONTA da Frente A (Evidence layer). NÃO foi colocada em
-- database/migrations/ de propósito: o ambiente da auditoria não roda
-- drizzle-kit (esbuild nativo é macOS, shell é Linux). Formalize na máquina
-- do repo com UM comando, que gera .sql + snapshot + journal de forma
-- autoritativa a partir do schema (a fonte da verdade, já atualizada):
--
--   pnpm --filter @desigual-os/database db:generate   # gera a migration + snapshot
--   pnpm --filter @desigual-os/database db:migrate     # aplica no Supabase
--
-- Se preferir aplicar direto sem drizzle-kit, o SQL abaixo é o que a tabela
-- precisa (equivalente ao que o generate produziria). Nesse caso, rode o
-- db:generate DEPOIS para o snapshot não ficar dessincronizado.

CREATE TABLE "agent_evidence" (
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
ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_evidence" ADD CONSTRAINT "agent_evidence_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_evidence_execution_id_idx" ON "agent_evidence" USING btree ("execution_id");
--> statement-breakpoint
CREATE INDEX "agent_evidence_agent_idx" ON "agent_evidence" USING btree ("agent");
--> statement-breakpoint
CREATE INDEX "agent_evidence_client_id_idx" ON "agent_evidence" USING btree ("client_id");
