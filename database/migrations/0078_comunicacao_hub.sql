CREATE TABLE IF NOT EXISTS "internal_chat_preferences" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"dnd_until" timestamp with time zone,
	"notify_reactions" boolean DEFAULT true NOT NULL,
	"notify_channel_messages" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_chat_preferences_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_message_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"provider" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_saved_messages" (
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_saved_messages_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_task_creations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"clickup_task_id" text,
	"clickup_task_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_conversation_members" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "visibility" text;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "entity_type" text;--> statement-breakpoint
ALTER TABLE "internal_conversations" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "thread_root_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "last_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_messages" ADD COLUMN IF NOT EXISTS "pinned_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_chat_preferences" ADD CONSTRAINT "internal_chat_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_chat_preferences" ADD CONSTRAINT "internal_chat_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_objects" ADD CONSTRAINT "internal_message_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_objects" ADD CONSTRAINT "internal_message_objects_message_id_internal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."internal_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_objects" ADD CONSTRAINT "internal_message_objects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_saved_messages" ADD CONSTRAINT "internal_saved_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_saved_messages" ADD CONSTRAINT "internal_saved_messages_message_id_internal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."internal_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_saved_messages" ADD CONSTRAINT "internal_saved_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_task_creations" ADD CONSTRAINT "internal_task_creations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_task_creations" ADD CONSTRAINT "internal_task_creations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_task_creations" ADD CONSTRAINT "internal_task_creations_message_id_internal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."internal_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_message_objects_message_idx" ON "internal_message_objects" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_message_objects_object_idx" ON "internal_message_objects" USING btree ("organization_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_saved_messages_user_idx" ON "internal_saved_messages" USING btree ("user_id","organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_task_creations_idempotency_unique" ON "internal_task_creations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_conversations" ADD CONSTRAINT "internal_conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_conversations_channel_name_unique" ON "internal_conversations" USING btree ("organization_id",lower("title")) WHERE kind = 'channel' and archived_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_conversations_discussion_unique" ON "internal_conversations" USING btree ("organization_id","entity_type","entity_id") WHERE kind = 'discussion';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_messages_thread_idx" ON "internal_messages" USING btree ("thread_root_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_messages_mentions_idx" ON "internal_messages" USING gin ("mentions");