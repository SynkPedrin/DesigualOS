CREATE TABLE IF NOT EXISTS "pipeline_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posicao" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"stage_id" text NOT NULL,
	"name" text NOT NULL,
	"client_id" uuid,
	"clickup_task_id" text,
	"responsavel" text,
	"valor" text,
	"nota" text DEFAULT '' NOT NULL,
	"posicao" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_boards" ADD CONSTRAINT "pipeline_boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_boards" ADD CONSTRAINT "pipeline_boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_board_id_pipeline_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."pipeline_boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_cards" ADD CONSTRAINT "pipeline_cards_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_boards_org_owner_idx" ON "pipeline_boards" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_cards_board_stage_idx" ON "pipeline_cards" USING btree ("board_id","stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_cards_board_task_uq" ON "pipeline_cards" USING btree ("board_id","clickup_task_id") WHERE clickup_task_id is not null and deleted_at is null;