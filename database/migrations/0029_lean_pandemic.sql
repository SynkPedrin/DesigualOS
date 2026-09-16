CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_type" text DEFAULT 'clickup' NOT NULL,
	"source_list_id" text,
	"task_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"open_task_count" integer DEFAULT 0 NOT NULL,
	"last_source_update_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_client_normalized_unique" UNIQUE("client_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_knowledge_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"last_source_update_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cks_client_source_unique" UNIQUE("client_id","source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email" text,
	"clickup_user_id" text,
	"employment_type" text DEFAULT 'unknown' NOT NULL,
	"active_status" text DEFAULT 'unknown' NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_client_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"temporal_status" text DEFAULT 'current' NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pcr_person_client_type_unique" UNIQUE("person_id","client_id","relation_type")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_knowledge_sync" ADD CONSTRAINT "client_knowledge_sync_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_client_relations" ADD CONSTRAINT "person_client_relations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "person_client_relations" ADD CONSTRAINT "person_client_relations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_client_id_idx" ON "campaigns" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_normalized_name_idx" ON "campaigns" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cks_client_id_idx" ON "client_knowledge_sync" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_normalized_name_idx" ON "people" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcr_person_id_idx" ON "person_client_relations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcr_client_id_idx" ON "person_client_relations" USING btree ("client_id");