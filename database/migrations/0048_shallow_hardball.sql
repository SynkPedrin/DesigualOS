-- ATENÇÃO: este arquivo foi PODADO à mão depois do `drizzle-kit generate`.
-- As migrações 0044-0047 foram escritas à mão e não geraram snapshot em
-- `meta/`, então o drizzle-kit diffiou a partir do snapshot 0043 e repetiu
-- aqui o DDL delas inteiro (tabelas mcp_*, colunas organization_id, etc.) —
-- incluindo `ADD COLUMN` sem IF NOT EXISTS, que FALHARIA num banco que já
-- aplicou 0044-0047. Ficou só o DDL desta feature. O snapshot
-- `meta/0048_snapshot.json` foi mantido completo de propósito: é ele que
-- ancora os próximos `db:generate`, e ele reflete o schema atual correto.
CREATE TABLE IF NOT EXISTS "memory_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"model" text NOT NULL,
	"vector" jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_embeddings_memory_id_idx" ON "memory_embeddings" USING btree ("memory_id");
