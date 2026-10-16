CREATE TABLE IF NOT EXISTS "bento_whatsapp_inbound" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"session_id" text NOT NULL,
	"wa_message_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"sender_phone" text,
	"kind" text NOT NULL,
	"text" text,
	"link_id" uuid,
	"user_id" uuid,
	"organization_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"reason" text,
	"conversation_id" uuid,
	"execution_id" text,
	"reply_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bento_whatsapp_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_phone" text,
	"claimed_chat_id" text,
	"claimed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bento_whatsapp_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"conversation_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_inbound" ADD CONSTRAINT "bento_whatsapp_inbound_link_id_bento_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."bento_whatsapp_links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_inbound" ADD CONSTRAINT "bento_whatsapp_inbound_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_inbound" ADD CONSTRAINT "bento_whatsapp_inbound_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_link_codes" ADD CONSTRAINT "bento_whatsapp_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_link_codes" ADD CONSTRAINT "bento_whatsapp_link_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_links" ADD CONSTRAINT "bento_whatsapp_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_links" ADD CONSTRAINT "bento_whatsapp_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_links" ADD CONSTRAINT "bento_whatsapp_links_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bento_whatsapp_links" ADD CONSTRAINT "bento_whatsapp_links_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bento_whatsapp_inbound_dedupe_key_idx" ON "bento_whatsapp_inbound" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bento_whatsapp_inbound_status_idx" ON "bento_whatsapp_inbound" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bento_whatsapp_inbound_chat_idx" ON "bento_whatsapp_inbound" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bento_whatsapp_link_codes_code_hash_idx" ON "bento_whatsapp_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bento_whatsapp_link_codes_user_id_idx" ON "bento_whatsapp_link_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bento_whatsapp_links_phone_active_idx" ON "bento_whatsapp_links" USING btree ("phone") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bento_whatsapp_links_user_active_idx" ON "bento_whatsapp_links" USING btree ("user_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bento_whatsapp_links_user_id_idx" ON "bento_whatsapp_links" USING btree ("user_id");