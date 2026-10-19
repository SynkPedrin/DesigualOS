CREATE TABLE IF NOT EXISTS "whatsapp_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"external_group_id" text NOT NULL,
	"name" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" text DEFAULT 'openwa' NOT NULL,
	"external_session_id" text NOT NULL,
	"external_name" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"webhook_secret_encrypted" text NOT NULL,
	"webhook_id" text,
	"phone_number" text,
	"push_name" text,
	"status" text DEFAULT 'created' NOT NULL,
	"engine_loaded" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"processed_contacts" integer DEFAULT 0 NOT NULL,
	"processed_chats" integer DEFAULT 0 NOT NULL,
	"processed_messages" integer DEFAULT 0 NOT NULL,
	"duplicate_messages" integer DEFAULT 0 NOT NULL,
	"imported_media" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_messages" DROP CONSTRAINT "thread_messages_channel_external_id_unique";--> statement-breakpoint
ALTER TABLE "conversation_threads" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "whatsapp_session_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "external_chat_id" text;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "kind" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "unread_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "last_message_preview" text;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "whatsapp_session_id" uuid;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "provider_session_key" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "sender_external_id" text;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "attachment_filename" text;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "attachment_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sync_jobs" ADD CONSTRAINT "whatsapp_sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sync_jobs" ADD CONSTRAINT "whatsapp_sync_jobs_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_sync_jobs" ADD CONSTRAINT "whatsapp_sync_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_groups_session_external_unique" ON "whatsapp_groups" USING btree ("session_id","external_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_groups_organization_idx" ON "whatsapp_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_external_session_unique" ON "whatsapp_sessions" USING btree ("external_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_owner_provider_unique" ON "whatsapp_sessions" USING btree ("organization_id","owner_user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_organization_idx" ON "whatsapp_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_status_idx" ON "whatsapp_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_sync_jobs_session_idx" ON "whatsapp_sync_jobs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_sync_jobs_status_idx" ON "whatsapp_sync_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_webhook_events_dedupe_unique" ON "whatsapp_webhook_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_session_idx" ON "whatsapp_webhook_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_status_idx" ON "whatsapp_webhook_events" USING btree ("status","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_whatsapp_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_group_id_whatsapp_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."whatsapp_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_whatsapp_session_id_whatsapp_sessions_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_threads_session_chat_idx" ON "conversation_threads" USING btree ("whatsapp_session_id","external_chat_id");--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_org_channel_session_external_unique" UNIQUE("organization_id","channel","provider_session_key","external_message_id");