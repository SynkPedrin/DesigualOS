CREATE TABLE IF NOT EXISTS "feature_announcement_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"state" text DEFAULT 'not_seen' NOT NULL,
	"first_seen_at" timestamp with time zone,
	"auto_shown_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"tutorial_version" integer,
	"tutorial_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"type" text DEFAULT 'NEW_FEATURE' NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rollout" text DEFAULT 'off' NOT NULL,
	"qa_user_ids" uuid[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"preview_image_url" text,
	"primary_cta" jsonb NOT NULL,
	"secondary_cta" jsonb,
	"tutorial_id" text,
	"tutorial_version" integer DEFAULT 1 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"display" jsonb DEFAULT '{"auto_open":true}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_announcement_states" ADD CONSTRAINT "feature_announcement_states_announcement_id_feature_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."feature_announcements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_announcement_states" ADD CONSTRAINT "feature_announcement_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_announcement_states" ADD CONSTRAINT "feature_announcement_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_announcements" ADD CONSTRAINT "feature_announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_announcement_states_announcement_user_uq" ON "feature_announcement_states" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_announcement_states_user_idx" ON "feature_announcement_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_announcements_key_uq" ON "feature_announcements" USING btree ("key");--> statement-breakpoint
-- O lançamento da Comunicação nasce DESLIGADO (rollout 'off'): só aparece para alguém depois
-- que o painel de admin passar para 'qa' e, validado, para 'all'. Reaplicar não duplica.
INSERT INTO "feature_announcements" ("key", "type", "title", "subtitle", "description", "audience", "rollout", "primary_cta", "secondary_cta", "tutorial_id", "tutorial_version", "priority", "display", "preview_image_url")
VALUES (
  'communication_hub_launch_v1',
  'NEW_FEATURE',
  'A comunicação da sua equipe evoluiu.',
  'Conheça o novo espaço de colaboração do Desigual OS.',
  'Agora você pode conversar com seus colegas, criar grupos, compartilhar arquivos e discutir tarefas, campanhas e projetos sem sair da plataforma.',
  '{"modules":["comunicacao"]}'::jsonb,
  'off',
  '{"label":"Conhecer a novidade","action":"start_tutorial"}'::jsonb,
  '{"label":"Explorar depois","action":"dismiss"}'::jsonb,
  'communication_hub_v1',
  1,
  100,
  '{"auto_open":true,"icon":"MessagesSquare","notification":{"title":"Nova funcionalidade: Comunicação","body":"A equipe agora tem um espaço próprio para conversar, compartilhar arquivos e colaborar em projetos dentro do Desigual OS.","action_label":"Conhecer","link":"/comunicacao?c=geral&tour=communication_hub_launch_v1"}}'::jsonb,
  '/anuncios/comunicacao.png'
)
ON CONFLICT ("key") DO NOTHING;
