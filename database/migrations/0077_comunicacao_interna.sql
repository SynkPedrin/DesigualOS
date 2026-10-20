CREATE TABLE IF NOT EXISTS "internal_conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"direct_key" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mimetype" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_message_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text,
	"reply_to_id" uuid,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"client_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_conversation_members" ADD CONSTRAINT "internal_conversation_members_conversation_id_internal_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."internal_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_conversation_members" ADD CONSTRAINT "internal_conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_conversation_members" ADD CONSTRAINT "internal_conversation_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_conversations" ADD CONSTRAINT "internal_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_attachments" ADD CONSTRAINT "internal_message_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_attachments" ADD CONSTRAINT "internal_message_attachments_conversation_id_internal_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."internal_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_attachments" ADD CONSTRAINT "internal_message_attachments_message_id_internal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."internal_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_attachments" ADD CONSTRAINT "internal_message_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_reactions" ADD CONSTRAINT "internal_message_reactions_message_id_internal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."internal_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_message_reactions" ADD CONSTRAINT "internal_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_conversation_id_internal_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."internal_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_conversation_members_user_idx" ON "internal_conversation_members" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_conversations_general_unique" ON "internal_conversations" USING btree ("organization_id") WHERE kind = 'general';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_conversations_direct_unique" ON "internal_conversations" USING btree ("organization_id","direct_key") WHERE kind = 'direct';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_conversations_org_recent_idx" ON "internal_conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_message_attachments_message_idx" ON "internal_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_message_attachments_conversation_idx" ON "internal_message_attachments" USING btree ("conversation_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internal_messages_idempotency_unique" ON "internal_messages" USING btree ("conversation_id","sender_id","client_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_messages_page_idx" ON "internal_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_messages_content_trgm_idx" ON "internal_messages" USING gin ("content" gin_trgm_ops);